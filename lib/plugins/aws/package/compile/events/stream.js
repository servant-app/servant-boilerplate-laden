'use strict';

const _ = require('lodash');
const resolveLambdaTarget = require('../../../utils/resolve-lambda-target');
const ServerlessError = require('../../../../../serverless-error');

class AwsCompileStreamEvents {
  constructor(serverless) {
    this.serverless = serverless;
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'initialize': () => {
        if (
          Object.values(this.serverless.service.functions).some(({ events }) =>
            events.some(({ stream: eventObject }) => {
              const consumer = eventObject && eventObject.consumer;
              const usesServiceSpecificNamingMode =
                this.serverless.service.provider.kinesis &&
                this.serverless.service.provider.kinesis.consumerNamingMode &&
                _.get(this.serverless, 'service.provider.kinesis.consumerNamingMode') ===
                  'serviceSpecific';
              return consumer && !usesServiceSpecificNamingMode;
            })
          )
        ) {
          this.serverless._logDeprecation(
            'KINESIS_CONSUMER_NAME_CONTAINING_SERVICE',
            'Starting with v4.0.0 Kinesis streams naming scheme will change. Adapt to new schema by setting`provider.kinesis.consumerNamingMode` property to `serviceSpecific`.'
          );
        }
      },
      'package:compileEvents': async () => this.compileStreamEvents(),
    };

    this.serverless.configSchemaHandler.defineFunctionEvent('aws', 'stream', {
      anyOf: [
        { $ref: '#/definitions/awsArnString' },
        {
          type: 'object',
          properties: {
            // arn constraints are listed in oneOf property of this schema
            arn: {},
            type: { enum: ['dynamodb', 'kinesis'] },
            batchSize: { type: 'integer', minimum: 1, maximum: 10000 },
            parallelizationFactor: { type: 'integer', minimum: 1, maximum: 10 },
            startingPosition: { enum: ['LATEST', 'TRIM_HORIZON', 'AT_TIMESTAMP'] },
            startingPositionTimestamp: { type: 'number' },
            enabled: { type: 'boolean' },
            consumer: { anyOf: [{ const: true }, { $ref: '#/definitions/awsArn' }] },
            batchWindow: { type: 'integer', minimum: 0, maximum: 300 },
            maximumRetryAttempts: { type: 'integer', minimum: -1, maximum: 10000 },
            bisectBatchOnFunctionError: { type: 'boolean' },
            maximumRecordAgeInSeconds: {
              anyOf: [{ const: -1 }, { type: 'integer', minimum: 60, maximum: 604800 }],
            },
            functionResponseType: { enum: ['ReportBatchItemFailures'] },
            destinations: {
              type: 'object',
              properties: {
                onFailure: {
                  anyOf: [
                    { $ref: '#/definitions/awsArnString' },
                    {
                      type: 'object',
                      properties: {
                        // arn constraints are listed in oneOf property of this schema
                        arn: {},
                        type: { enum: ['sns', 'sqs'] },
                      },
                      additionalProperties: false,
                      anyOf: [
                        {
                          properties: {
                            arn: { $ref: '#/definitions/awsCfFunction' },
                          },
                          required: ['arn', 'type'],
                        },
                        {
                          properties: {
                            arn: { $ref: '#/definitions/awsArnString' },
                          },
                          required: ['arn'],
                        },
                      ],
                    },
                  ],
                },
              },
              additionalProperties: false,
              required: ['onFailure'],
            },
            tumblingWindowInSeconds: { type: 'integer', minimum: 0, maximum: 900 },
            filterPatterns: { $ref: '#/definitions/filterPatterns' },
          },
          additionalProperties: false,
          anyOf: [
            {
              properties: {
                arn: { $ref: '#/definitions/awsCfFunction' },
              },
              required: ['arn', 'type'],
            },
            {
              properties: {
                arn: { $ref: '#/definitions/awsArnString' },
              },
              required: ['arn'],
            },
          ],
        },
      ],
    });
  }

  compileStreamEvents() {
    const dynamodbStreamStatement = {
      Effect: 'Allow',
      Action: [
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:DescribeStream',
        'dynamodb:ListStreams',
      ],
      Resource: [],
    };
    const kinesisStreamStatement = {
      Effect: 'Allow',
      Action: [
        'kinesis:GetRecords',
        'kinesis:GetShardIterator',
        'kinesis:DescribeStream',
        'kinesis:ListStreams',
      ],
      Resource: [],
    };
    const kinesisStreamWithConsumerStatement = {
      Effect: 'Allow',
      Action: [
        'kinesis:GetRecords',
        'kinesis:GetShardIterator',
        'kinesis:DescribeStreamSummary',
        'kinesis:ListShards',
      ],
      Resource: [],
    };
    const kinesisConsumerStatement = {
      Effect: 'Allow',
      Action: ['kinesis:SubscribeToShard'],
      Resource: [],
    };
    const onFailureSnsStatement = {
      Effect: 'Allow',
      Action: ['sns:Publish'],
      Resource: [],
    };
    const onFailureSqsStatement = {
      Effect: 'Allow',
      Action: ['sqs:ListQueues', 'sqs:SendMessage'],
      Resource: [],
    };

    this.serverless.service.getAllFunctions().forEach((functionName) => {
      const functionObj = this.serverless.service.getFunction(functionName);

      if (functionObj.events) {
        functionObj.events.forEach((event) => {
          if (event.stream) {
            let EventSourceArn;
            let BatchSize = 10;
            let ParallelizationFactor;
            let StartingPosition = 'TRIM_HORIZON';
            let Enabled = true;

            if (typeof event.stream === 'object') {
              EventSourceArn = event.stream.arn;
              BatchSize = event.stream.batchSize || BatchSize;
              if (event.stream.parallelizationFactor) {
                ParallelizationFactor = event.stream.parallelizationFactor;
              }
              StartingPosition = event.stream.startingPosition || StartingPosition;

              if (typeof event.stream.enabled !== 'undefined') {
                Enabled = event.stream.enabled;
              }
            } else {
              EventSourceArn = event.stream;
            }

            const streamType = event.stream.type || EventSourceArn.split(':')[2];
            const streamName = (function () {
              if (EventSourceArn['Fn::GetAtt']) {
                return EventSourceArn['Fn::GetAtt'][0];
              } else if (EventSourceArn['Fn::ImportValue']) {
                return EventSourceArn['Fn::ImportValue'];
              } else if (EventSourceArn.Ref) {
                return EventSourceArn.Ref;
              } else if (EventSourceArn['Fn::Join']) {
                // [0] is the used delimiter, [1] is the array with values
                const name = EventSourceArn['Fn::Join'][1].slice(-1).pop();
                if (name.split('/').length) {
                  return name.split('/').pop();
                }
                return name;
              }
              return EventSourceArn.split('/')[1];
            })();

            const streamLogicalId = this.provider.naming.getStreamLogicalId(
              functionName,
              streamType,
              streamName
            );

            const dependsOn = [];
            const functionIamRoleResourceName =
              this.provider.resolveFunctionIamRoleResourceName(functionObj);
            if (functionIamRoleResourceName) {
              dependsOn.push(functionIamRoleResourceName);
            }
            const { targetAlias } = this.serverless.service.functions[functionName];
            if (targetAlias) {
              dependsOn.push(targetAlias.logicalId);
            }

            const streamResource = {
              Type: 'AWS::Lambda::EventSourceMapping',
              DependsOn: dependsOn,
              Properties: {
                BatchSize,
                Enabled,
                EventSourceArn,
                FunctionName: resolveLambdaTarget(functionName, functionObj),
                ParallelizationFactor,
                StartingPosition,
              },
            };

            // add event source ARNs to PolicyDocument statements
            if (streamType === 'dynamodb') {
              dynamodbStreamStatement.Resource.push(EventSourceArn);
            } else if (event.stream.consumer) {
              kinesisStreamWithConsumerStatement.Resource.push(EventSourceArn);
            } else {
              kinesisStreamStatement.Resource.push(EventSourceArn);
            }

            if (event.stream.batchWindow != null) {
              streamResource.Properties.MaximumBatchingWindowInSeconds = event.stream.batchWindow;
            }

            if (event.stream.maximumRetryAttempts != null) {
              streamResource.Properties.MaximumRetryAttempts = event.stream.maximumRetryAttempts;
            }

            if (event.stream.bisectBatchOnFunctionError != null) {
              streamResource.Properties.BisectBatchOnFunctionError =
                event.stream.bisectBatchOnFunctionError;
            }

            if (event.stream.functionResponseType != null) {
              streamResource.Properties.FunctionResponseTypes = [event.stream.functionResponseType];
            }

            if (event.stream.maximumRecordAgeInSeconds) {
              streamResource.Properties.MaximumRecordAgeInSeconds =
                event.stream.maximumRecordAgeInSeconds;
            }

            if (event.stream.tumblingWindowInSeconds != null) {
              streamResource.Properties.TumblingWindowInSeconds =
                event.stream.tumblingWindowInSeconds;
            }

            if (event.stream.destinations) {
              let OnFailureDestinationArn;

              if (typeof event.stream.destinations.onFailure === 'object') {
                OnFailureDestinationArn = event.stream.destinations.onFailure.arn;
              } else {
                OnFailureDestinationArn = event.stream.destinations.onFailure;
              }

              const destinationType =
                event.stream.destinations.onFailure.type || OnFailureDestinationArn.split(':')[2];
              // add on failure destination ARNs to PolicyDocument statements
              if (destinationType === 'sns') {
                onFailureSnsStatement.Resource.push(OnFailureDestinationArn);
              } else {
                onFailureSqsStatement.Resource.push(OnFailureDestinationArn);
              }

              streamResource.Properties.DestinationConfig = {
                OnFailure: {
                  Destination: OnFailureDestinationArn,
                },
              };
            }

            if (event.stream.filterPatterns) {
              streamResource.Properties.FilterCriteria = {
                Filters: event.stream.filterPatterns.map((pattern) => ({
                  Pattern: JSON.stringify(pattern),
                })),
              };
            }

            const newStreamObject = {
              [streamLogicalId]: streamResource,
            };

            if (event.stream.consumer && streamType === 'kinesis') {
              if (event.stream.consumer === true) {
                const consumerName = this.provider.naming.getStreamConsumerName(
                  functionName,
                  streamName
                );
                const consumerResource = {
                  Type: 'AWS::Kinesis::StreamConsumer',
                  Properties: {
                    StreamARN: EventSourceArn,
                    ConsumerName: consumerName,
                  },
                };
                const consumerLogicalId =
                  this.provider.naming.getStreamConsumerLogicalId(consumerName);
                newStreamObject[consumerLogicalId] = consumerResource;
                if (Array.isArray(streamResource.DependsOn)) {
                  streamResource.DependsOn.push(consumerLogicalId);
                } else {
                  streamResource.DependsOn = [streamResource.DependsOn, consumerLogicalId];
                }
                const consumerArnRef = {
                  Ref: consumerLogicalId,
                };
                streamResource.Properties.EventSourceArn = consumerArnRef;
                kinesisConsumerStatement.Resource.push(consumerArnRef);
              } else {
                const consumerArn = event.stream.consumer;
                streamResource.Properties.EventSourceArn = consumerArn;
                kinesisConsumerStatement.Resource.push(consumerArn);
              }

              if (
                event.stream.startingPosition === 'AT_TIMESTAMP' &&
                !event.stream.startingPositionTimestamp
              ) {
                throw new ServerlessError(
                  `You must specify startingPositionTimestamp for function: ${functionName} when startingPosition is AT_TIMESTAMP`,
                  'FUNCTION_STREAM_STARTING_POSITION_TIMESTAMP_INVALID'
                );
              }

              if (event.stream.startingPositionTimestamp) {
                streamResource.Properties.StartingPositionTimestamp =
                  event.stream.startingPositionTimestamp;
              }
            }

            _.merge(
              this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
              newStreamObject
            );
          }
        });
      }
    });

    // update the PolicyDocument statements (if default policy is used)
    if (
      this.serverless.service.provider.compiledCloudFormationTemplate.Resources
        .IamRoleLambdaExecution
    ) {
      const statement =
        this.serverless.service.provider.compiledCloudFormationTemplate.Resources
          .IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument.Statement;
      if (dynamodbStreamStatement.Resource.length) {
        statement.push(dynamodbStreamStatement);
      }
      if (kinesisStreamStatement.Resource.length) {
        statement.push(kinesisStreamStatement);
      }
      if (kinesisStreamWithConsumerStatement.Resource.length) {
        statement.push(kinesisStreamWithConsumerStatement);
      }
      if (kinesisConsumerStatement.Resource.length) {
        statement.push(kinesisConsumerStatement);
      }
      if (onFailureSnsStatement.Resource.length) {
        statement.push(onFailureSnsStatement);
      }
      if (onFailureSqsStatement.Resource.length) {
        statement.push(onFailureSqsStatement);
      }
    }
  }
}

module.exports = AwsCompileStreamEvents;
