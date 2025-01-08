import ServerlessError from '../../../../../serverless-error.js'
import resolveLambdaTarget from '../../../utils/resolve-lambda-target.js'
import utils from '@serverlessinc/sf-core/src/utils.js'

const { log, style } = utils

const rateSyntax =
  '^rate\\((?:1 (?:minute|hour|day)|(?:1\\d+|[2-9]\\d*) (?:minute|hour|day)s)\\)$'
const cronSyntax = '^cron\\(\\S+ \\S+ \\S+ \\S+ \\S+ \\S+\\)$'
const scheduleSyntax = `${rateSyntax}|${cronSyntax}`

const METHOD_SCHEDULER = 'scheduler'
const METHOD_EVENT_BUS = 'eventBus'

class AwsCompileScheduledEvents {
  constructor(serverless) {
    this.serverless = serverless
    this.provider = this.serverless.getProvider('aws')

    this.hooks = {
      'package:compileEvents': async () => this.compileScheduledEvents(),
    }

    this.serverless.configSchemaHandler.defineFunctionEvent('aws', 'schedule', {
      anyOf: [
        { type: 'string', pattern: scheduleSyntax },
        {
          type: 'object',
          properties: {
            rate: {
              type: 'array',
              minItems: 1,
              items: {
                anyOf: [
                  { $ref: '#/definitions/awsCfFunction' },
                  {
                    type: 'string',
                    pattern: scheduleSyntax,
                  },
                ],
              },
            },
            enabled: { type: 'boolean' },
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
              pattern: '[\\.\\-_A-Za-z0-9]+',
            },
            description: { type: 'string', maxLength: 512 },
            input: {
              anyOf: [
                { type: 'string', maxLength: 8192 },
                {
                  type: 'object',
                  oneOf: [
                    {
                      properties: {
                        body: { type: 'string', maxLength: 8192 },
                      },
                      required: ['body'],
                      additionalProperties: false,
                    },
                    {
                      not: {
                        required: ['body'],
                      },
                    },
                  ],
                },
              ],
            },
            inputPath: { type: 'string', maxLength: 256 },
            inputTransformer: {
              type: 'object',
              properties: {
                inputTemplate: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 8192,
                },
                inputPathsMap: { type: 'object' },
              },
              required: ['inputTemplate'],
              additionalProperties: false,
            },
            method: {
              type: 'string',
              enum: [METHOD_EVENT_BUS, METHOD_SCHEDULER],
            },
            roleArn: { $ref: '#/definitions/awsArn' },
            timezone: {
              type: 'string',
              pattern: '[\\w\\-\\/]+',
            },
          },
          required: ['rate'],
          additionalProperties: false,
        },
      ],
    })
  }

  compileScheduledEvents() {
    const schedulerStatement = {
      Effect: 'Allow',
      Action: ['lambda:InvokeFunction'],
      Resource: [],
    }

    const resources =
      this.serverless.service.provider.compiledCloudFormationTemplate.Resources
    let hasSchedulerEvents = false

    this.serverless.service.getAllFunctions().forEach((functionName) => {
      const functionObj = this.serverless.service.getFunction(functionName)
      let scheduleNumberInFunction = 0
      let functionHasSchedulerEvent = false

      if (functionObj.events) {
        functionObj.events.forEach((event) => {
          if (event.schedule) {
            let ScheduleExpressions
            let State
            let Input
            let InputPath
            let InputTransformer
            let Name
            let Description
            let method
            let roleArn
            let timezone

            if (typeof event.schedule === 'object') {
              ScheduleExpressions = event.schedule.rate

              State = 'ENABLED'
              if (event.schedule.enabled === false) {
                State = 'DISABLED'
              }
              Input = event.schedule.input
              InputPath = event.schedule.inputPath
              InputTransformer = event.schedule.inputTransformer
              Name = event.schedule.name
              timezone = event.schedule.timezone
              Description = event.schedule.description
              roleArn = event.schedule.roleArn;

              const functionLogicalId =
                this.provider.naming.getLambdaLogicalId(functionName)
              const functionResource = resources[functionLogicalId]

              roleArn = roleArn || functionResource.Properties.Role;

              method = event.schedule.method || METHOD_EVENT_BUS

              if (ScheduleExpressions.length > 1 && Name) {
                throw new ServerlessError(
                  'You cannot specify a name when defining more than one rate expression',
                  'SCHEDULE_NAME_NOT_ALLOWED_MULTIPLE_RATES',
                )
              }

              if (Input && typeof Input === 'object') {
                if (typeof Input.body === 'string') {
                  Input.body = JSON.parse(Input.body)
                }
                Input = JSON.stringify(Input)
              }
              if (
                Input &&
                typeof Input === 'string' &&
                method !== METHOD_SCHEDULER
              ) {
                // escape quotes to favor JSON.parse
                Input = Input.replace(/"/g, '\\"')
              }
              if (InputTransformer) {
                if (method === METHOD_SCHEDULER) {
                  throw new ServerlessError(
                    'Cannot setup "schedule" event: "inputTransformer" is not supported with "scheduler" mode',
                    'SCHEDULE_PARAMETER_NOT_SUPPORTED',
                  )
                } else {
                  InputTransformer =
                    this.formatInputTransformer(InputTransformer)
                }
              }
              if (InputPath && method === METHOD_SCHEDULER) {
                throw new ServerlessError(
                  'Cannot setup "schedule" event: "inputPath" is not supported with "scheduler" mode',
                  'SCHEDULE_PARAMETER_NOT_SUPPORTED',
                )
              }
              if (timezone && method !== METHOD_SCHEDULER) {
                throw new ServerlessError(
                  'Cannot setup "schedule" event: "timezone" is only supported with "scheduler" mode',
                  'SCHEDULE_PARAMETER_NOT_SUPPORTED',
                )
              }
            } else {
              ScheduleExpressions = [event.schedule]
              State = 'ENABLED'
            }

            const lambdaTarget = resolveLambdaTarget(functionName, functionObj)
            const lambdaTargetJson = JSON.stringify(lambdaTarget)
            const dependsOn =
              functionObj && functionObj.targetAlias
                ? functionObj.targetAlias.logicalId
                : undefined

            const scheduleId = this.provider.naming.getScheduleId(functionName)

            for (const ScheduleExpression of ScheduleExpressions) {
              scheduleNumberInFunction++

              if (method === METHOD_SCHEDULER) {
                hasSchedulerEvents = true
                functionHasSchedulerEvent = true

                const scheduleLogicalId =
                  this.provider.naming.getSchedulerScheduleLogicalId(
                    functionName,
                    scheduleNumberInFunction,
                  )

                resources[scheduleLogicalId] = {
                  Type: 'AWS::Scheduler::Schedule',
                  DependsOn: dependsOn,
                  Properties: {
                    ScheduleExpression,
                    State,
                    Target: {
                      Arn: lambdaTarget,
                      RoleArn: roleArn,
                      Input,
                    },
                    FlexibleTimeWindow: {
                      Mode: 'OFF',
                    },
                    Name,
                    Description,
                    ScheduleExpressionTimezone: timezone,
                  },
                }
              } else {
                const scheduleLogicalId =
                  this.provider.naming.getScheduleLogicalId(
                    functionName,
                    scheduleNumberInFunction,
                  )

                const lambdaPermissionLogicalId =
                  this.provider.naming.getLambdaSchedulePermissionLogicalId(
                    functionName,
                    scheduleNumberInFunction,
                  )

                let templateScheduleExpression
                if (typeof ScheduleExpression === 'string') {
                  templateScheduleExpression = `"${ScheduleExpression}"`
                } else {
                  templateScheduleExpression =
                    JSON.stringify(ScheduleExpression)
                }

                const scheduleTemplate = `
                  {
                    "Type": "AWS::Events::Rule",
                    ${dependsOn ? `"DependsOn": "${dependsOn}",` : ''}
                    "Properties": {
                      "ScheduleExpression": ${templateScheduleExpression},
                      "State": "${State}",
                      ${Name ? `"Name": "${Name}",` : ''}
                      ${Description ? `"Description": "${Description}",` : ''}
                      "Targets": [{
                        ${Input ? `"Input": "${Input}",` : ''}
                        ${InputPath ? `"InputPath": "${InputPath}",` : ''}
                        ${
                          InputTransformer
                            ? `"InputTransformer": ${InputTransformer},`
                            : ''
                        }
                        "Arn": ${lambdaTargetJson},
                        "Id": "${scheduleId}"
                      }]
                    }
                  }
                `

                const permissionTemplate = `
                  {
                    "Type": "AWS::Lambda::Permission",
                    ${dependsOn ? `"DependsOn": "${dependsOn}",` : ''}
                    "Properties": {
                      "FunctionName": ${lambdaTargetJson},
                      "Action": "lambda:InvokeFunction",
                      "Principal": "events.amazonaws.com",
                      "SourceArn": { "Fn::GetAtt": ["${scheduleLogicalId}", "Arn"] }
                    }
                  }
                `

                const newScheduleObject = {
                  [scheduleLogicalId]: JSON.parse(scheduleTemplate),
                }

                const newPermissionObject = {
                  [lambdaPermissionLogicalId]: JSON.parse(permissionTemplate),
                }

                Object.assign(resources, newScheduleObject, newPermissionObject)
              }
            }
          }
        })
      }

      if (functionHasSchedulerEvent) {
        const functionArnWithVars =
          'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}' +
          `:function:${functionObj.name}`

        schedulerStatement.Resource.push(
          {
            'Fn::Sub': functionArnWithVars,
          },
          {
            'Fn::Sub': `${functionArnWithVars}:*`,
          },
        )
      }
    })

    if (hasSchedulerEvents) {
      if (!resources.IamRoleLambdaExecution) {
        log.info(
          `Remember to add required EventBridge Scheduler permissions to your execution role. Documentation: ${style.link(
            'https://docs.aws.amazon.com/scheduler/latest/UserGuide/setting-up.html#setting-up-execution-role',
          )}`,
        )
      } else {
        const lambdaAssumeStatement =
          resources.IamRoleLambdaExecution.Properties.AssumeRolePolicyDocument.Statement.find(
            (statement) =>
              statement.Principal.Service.includes('lambda.amazonaws.com'),
          )
        if (lambdaAssumeStatement) {
          lambdaAssumeStatement.Principal.Service.push(
            'scheduler.amazonaws.com',
          )
        }

        const policyDocumentStatements =
          resources.IamRoleLambdaExecution.Properties.Policies[0].PolicyDocument
            .Statement

        policyDocumentStatements.push(schedulerStatement)
      }
    }
  }

  formatInputTransformer(inputTransformer) {
    const cfmOutput = {
      // InputTemplate is required
      InputTemplate: inputTransformer.inputTemplate,
    }
    // InputPathsMap is optional
    if (inputTransformer.inputPathsMap) {
      cfmOutput.InputPathsMap = inputTransformer.inputPathsMap
    }
    return JSON.stringify(cfmOutput)
  }
}

export default AwsCompileScheduledEvents
