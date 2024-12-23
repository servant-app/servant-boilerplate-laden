'use strict';

const AWS = require('../../aws/sdk-v2');
const BbPromise = require('bluebird');
const _ = require('lodash');
const naming = require('./lib/naming.js');
const fsp = require('fs').promises;
const getS3EndpointForRegion = require('./utils/get-s3-endpoint-for-region');
const memoizeeMethods = require('memoizee/methods');
const readline = require('readline');
const { ALB_LISTENER_REGEXP } = require('./package/compile/events/alb/lib/validate');
const d = require('d');
const path = require('path');
const spawnExt = require('child-process-ext/spawn');
const ServerlessError = require('../../serverless-error');
const awsRequest = require('../../aws/request');
const { cfValue } = require('../../utils/aws-schema-get-cf-value');
const reportDeprecatedProperties = require('../../utils/report-deprecated-properties');
const deepSortObjectByKey = require('../../utils/deep-sort-object-by-key');
const { progress, log } = require('@serverless/utils/log');

const isLambdaArn = RegExp.prototype.test.bind(/^arn:[^:]+:lambda:/);
const isEcrUri = RegExp.prototype.test.bind(
  /^\d+\.dkr\.ecr\.[a-z0-9-]+..amazonaws.com\/([^@]+)|([^@:]+@sha256:[a-f0-9]{64})$/
);

function caseInsensitive(str) {
  return { type: 'string', regexp: new RegExp(`^${str}$`, 'i').toString() };
}

function resolveRuntimeManagement(input) {
  if (typeof input === 'string') {
    return {
      mode: input,
    };
  }
  return input;
}

const constants = {
  providerName: 'aws',
};

const imageNamePattern = '^[a-z][a-z0-9-_]{1,31}$';

const apiGatewayUsagePlan = {
  type: 'object',
  properties: {
    quota: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 0 },
        offset: { type: 'integer', minimum: 0 },
        period: { enum: ['DAY', 'WEEK', 'MONTH'] },
      },
      additionalProperties: false,
    },
    throttle: {
      type: 'object',
      properties: {
        burstLimit: { type: 'integer', minimum: 0 },
        rateLimit: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const impl = {
  /**
   * Determine whether the given credentials are valid.  It turned out that detecting invalid
   * credentials was more difficult than detecting the positive cases we know about.  Hooray for
   * whack-a-mole!
   * @param credentials The credentials to test for validity
   * @return {boolean} Whether the given credentials were valid
   */
  validCredentials: (credentials) => {
    let result = false;
    if (credentials) {
      if (
        // valid credentials loaded
        (credentials.accessKeyId &&
          credentials.accessKeyId !== 'undefined' &&
          credentials.secretAccessKey &&
          credentials.secretAccessKey !== 'undefined') ||
        // a role to assume has been successfully loaded, the associated STS request has been
        // sent, and the temporary credentials will be asynchronously delivered.
        credentials.roleArn
      ) {
        result = true;
      }
    }
    return result;
  },
  /**
   * Add credentials, if present, to the given results
   * @param results The results to add the given credentials to if they are valid
   * @param credentials The credentials to validate and add to the results if valid
   */
  addCredentials: (results, credentials) => {
    if (impl.validCredentials(credentials)) {
      results.credentials = credentials;
    }
  },
  /**
   * Add credentials, if present, from the environment
   * @param results The results to add environment credentials to
   * @param prefix The environment variable prefix to use in extracting credentials
   */
  addEnvironmentCredentials: (results, prefix) => {
    if (prefix) {
      const environmentCredentials = new AWS.EnvironmentCredentials(prefix);
      impl.addCredentials(results, environmentCredentials);
    }
  },
  /**
   * Add credentials from a profile, if the profile and credentials for it exists
   * @param results The results to add profile credentials to
   * @param profile The profile to load credentials from
   */
  addProfileCredentials: (results, profile) => {
    if (profile) {
      const params = { profile };
      if (process.env.AWS_SHARED_CREDENTIALS_FILE) {
        params.filename = process.env.AWS_SHARED_CREDENTIALS_FILE;
      }

      // Setup a MFA callback for asking the code from the user.
      params.tokenCodeFn = (mfaSerial, callback) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`Enter MFA code for ${mfaSerial}: `, (answer) => {
          rl.close();
          callback(null, answer);
        });
      };

      const profileCredentials = new AWS.SharedIniFileCredentials(params);
      if (
        !(
          profileCredentials.accessKeyId ||
          profileCredentials.sessionToken ||
          profileCredentials.roleArn
        )
      ) {
        throw new ServerlessError(
          `AWS profile "${profile}" doesn't seem to be configured`,
          'UNRECOGNIZED_AWS_PROFILE'
        );
      }

      impl.addCredentials(results, profileCredentials);
    }
  },
  /**
   * Add credentials, if present, from a profile that is specified within the environment
   * @param results The prefix of the profile's declaration in the environment
   * @param prefix The prefix for the environment variable
   */
  addEnvironmentProfile: (results, prefix) => {
    if (prefix) {
      const profile = process.env[`${prefix}_PROFILE`];
      impl.addProfileCredentials(results, profile);
    }
  },
};

const baseAlbAuthorizerProperties = {
  onUnauthenticatedRequest: { enum: ['allow', 'authenticate', 'deny'] },
  requestExtraParams: {
    type: 'object',
    maxProperties: 10,
    additionalProperties: { type: 'string' },
  },
  scope: { type: 'string' },
  sessionCookieName: { type: 'string' },
  sessionTimeout: { type: 'integer', minimum: 0 },
};

const oidcAlbAuthorizer = {
  type: 'object',
  properties: {
    type: { const: 'oidc' },
    authorizationEndpoint: { format: 'uri', type: 'string' },
    clientId: { type: 'string' },
    clientSecret: { type: 'string' },
    issuer: { format: 'uri', type: 'string' },
    tokenEndpoint: { format: 'uri', type: 'string' },
    userInfoEndpoint: { format: 'uri', type: 'string' },
    ...baseAlbAuthorizerProperties,
  },
  required: [
    'type',
    'authorizationEndpoint',
    'clientId',
    'issuer',
    'tokenEndpoint',
    'userInfoEndpoint',
  ],
  additionalProperties: false,
};

const cognitoAlbAuthorizer = {
  type: 'object',
  properties: {
    type: { const: 'cognito' },
    userPoolArn: { $ref: '#/definitions/awsArn' },
    userPoolClientId: { type: 'string' },
    userPoolDomain: { type: 'string' },
    ...baseAlbAuthorizerProperties,
  },
  required: ['type', 'userPoolArn', 'userPoolClientId', 'userPoolDomain'],
  additionalProperties: false,
};

class AwsProvider {
  constructor(serverless, options) {
    this.naming = { provider: this };
    this.options = options;
    this.provider = this; // only load plugin in an AWS service context
    this.serverless = serverless;
    // Notice: provider.sdk is used by plugins. Do not remove without deprecating first and
    //         offering a reliable alternative
    this.sdk = AWS;
    this.serverless.setProvider(constants.providerName, this);
    this.hooks = {
      initialize: () => {
        // Support deploymentBucket configuration as an object
        const provider = this.serverless.service.provider;
        if (provider && provider.deploymentBucket) {
          if (_.isObject(provider.deploymentBucket)) {
            // store the object in a new variable so that it can be reused later on
            provider.deploymentBucketObject = provider.deploymentBucket;
            if (provider.deploymentBucket.name) {
              // (re)set the value of the deploymentBucket property to the name (which is a string)
              provider.deploymentBucket = provider.deploymentBucket.name;
            } else {
              provider.deploymentBucket = null;
            }
          }
        }
        reportDeprecatedProperties(
          'PROVIDER_IAM_SETTINGS_V3',
          {
            'provider.role': 'provider.iam.role',
            'provider.rolePermissionsBoundary': 'provider.iam.role.permissionsBoundary',
            'provider.iam.role.permissionBoundary': 'provider.iam.role.permissionsBoundary',
            'provider.iamManagedPolicies': 'provider.iam.role.managedPolicies',
            'provider.iamRoleStatements': 'provider.iam.role.statements',
            'provider.cfnRole': 'provider.iam.deploymentRole',
          },
          { serviceConfig: this.serverless.service }
        );
      },
    };

    if (this.serverless.service.provider.name === 'aws') {
      // Below ideally should be in hooks.initialize, but variables resolution depend on this
      this.serverless.service.provider.region = this.getRegion();
      require('../../utils/aws-sdk-patch');
      serverless.configSchemaHandler.defineProvider('aws', {
        definitions: {
          awsAccountId: {
            type: 'string',
            pattern: '^\\d{12}$',
          },
          awsAlbListenerArn: {
            type: 'string',
            pattern: ALB_LISTENER_REGEXP.source,
          },
          awsAlexaEventToken: {
            type: 'string',
            minLength: 0,
            maxLength: 256,
            pattern: '^[a-zA-Z0-9._\\-]+$',
          },
          awsApiGatewayAbbreviatedArn: {
            type: 'string',
            pattern: '^execute-api:/',
          },
          awsApiGatewayApiKeys: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  $ref: '#/definitions/awsApiGatewayApiKeysProperties',
                },
                {
                  type: 'object',
                  maxProperties: 1,
                  additionalProperties: {
                    type: 'array',
                    items: {
                      oneOf: [
                        { type: 'string' },
                        { $ref: '#/definitions/awsApiGatewayApiKeysProperties' },
                      ],
                    },
                  },
                },
              ],
            },
          },
          awsApiGatewayApiKeysProperties: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              description: { type: 'string' },
              customerId: { type: 'string' },
              enabled: { type: 'boolean' },
            },
            additionalProperties: false,
          },
          awsHttpApiPayload: {
            type: 'string',
            enum: ['1.0', '2.0'],
          },
          awsArn: {
            anyOf: [
              { $ref: '#/definitions/awsArnString' },
              { $ref: '#/definitions/awsCfFunction' },
            ],
          },
          awsArnString: {
            type: 'string',
            pattern: '^arn:',
          },
          awsCfArrayInstruction: {
            anyOf: [
              {
                type: 'array',
                items: { $ref: '#/definitions/awsCfInstruction' },
              },
              { $ref: '#/definitions/awsCfSplit' },
            ],
          },
          awsSecretsManagerArnString: {
            type: 'string',
            pattern: 'arn:[a-z-]+:secretsmanager:[a-z0-9-]+:\\d+:secret:[A-Za-z0-9/_+=.@-]+',
          },
          awsCfFunction: {
            anyOf: [
              { $ref: '#/definitions/awsCfImport' },
              { $ref: '#/definitions/awsCfJoin' },
              { $ref: '#/definitions/awsCfGetAtt' },
              { $ref: '#/definitions/awsCfRef' },
              { $ref: '#/definitions/awsCfSub' },
              { $ref: '#/definitions/awsCfBase64' },
              { $ref: '#/definitions/awsCfToJsonString' },
            ],
          },
          awsCfGetAtt: {
            type: 'object',
            properties: {
              'Fn::GetAtt': {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: { type: 'string', minLength: 1 },
              },
            },
            required: ['Fn::GetAtt'],
            additionalProperties: false,
          },
          awsCfGetAZs: {
            type: 'object',
            properties: {
              'Fn::GetAZs': {
                oneOf: [{ type: 'string', minLength: 1 }, { $ref: '#/definitions/awsCfRef' }],
              },
            },
            required: ['Fn::GetAZs'],
            additionalProperties: false,
          },
          awsCfImport: {
            type: 'object',
            properties: {
              'Fn::ImportValue': {},
            },
            additionalProperties: false,
            required: ['Fn::ImportValue'],
          },
          awsCfIf: {
            type: 'object',
            properties: {
              'Fn::If': {
                type: 'array',
                minItems: 3,
                maxItems: 3,
                items: { $ref: '#/definitions/awsCfInstruction' },
              },
            },
            required: ['Fn::If'],
            additionalProperties: false,
          },
          awsCfImportLocallyResolvable: {
            type: 'object',
            properties: {
              'Fn::ImportValue': { type: 'string' },
            },
            additionalProperties: false,
            required: ['Fn::ImportValue'],
          },
          awsCfInstruction: {
            anyOf: [{ type: 'string', minLength: 1 }, { $ref: '#/definitions/awsCfFunction' }],
          },
          awsCfJoin: {
            type: 'object',
            properties: {
              'Fn::Join': {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: [{ type: 'string' }, { type: 'array' }],
                additionalItems: false,
              },
            },
            required: ['Fn::Join'],
            additionalProperties: false,
          },
          awsCfSelect: {
            type: 'object',
            properties: {
              'Fn::Select': {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: {
                  anyOf: [
                    { type: 'number' },
                    { type: 'string' },
                    { type: 'array' },
                    { $ref: '#/definitions/awsCfFindInMap' },
                    { $ref: '#/definitions/awsCfGetAtt' },
                    { $ref: '#/definitions/awsCfGetAZs' },
                    { $ref: '#/definitions/awsCfIf' },
                    { $ref: '#/definitions/awsCfSplit' },
                    { $ref: '#/definitions/awsCfRef' },
                  ],
                },
              },
            },
            required: ['Fn::Select'],
            additionalProperties: false,
          },
          awsCfRef: {
            type: 'object',
            properties: {
              Ref: { type: 'string', minLength: 1 },
            },
            required: ['Ref'],
            additionalProperties: false,
          },
          awsCfSplit: {
            type: 'object',
            properties: {
              'Fn::Split': {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: {
                  oneOf: [{ type: 'string' }, { $ref: '#/definitions/awsCfFunction' }],
                },
              },
            },
            required: ['Fn::Split'],
            additionalProperties: false,
          },
          awsCfFindInMap: {
            type: 'object',
            properties: {
              'Fn::FindInMap': {
                type: 'array',
                minItems: 3,
                maxItems: 3,
                items: {
                  oneOf: [{ type: 'string' }, { $ref: '#/definitions/awsCfFunction' }],
                },
              },
            },
            required: ['Fn::FindInMap'],
            additionalProperties: false,
          },
          awsCfSub: {
            type: 'object',
            properties: {
              'Fn::Sub': {},
            },
            required: ['Fn::Sub'],
            additionalProperties: false,
          },
          awsCfBase64: {
            type: 'object',
            properties: {
              'Fn::Base64': {},
            },
          },
          awsCfToJsonString: {
            type: 'object',
            properties: {
              'Fn::ToJsonString': {
                anyOf: [{ type: 'object' }, { type: 'array' }],
              },
            },
            required: ['Fn::ToJsonString'],
            additionalProperties: false,
          },
          awsIamPolicyAction: { type: 'array', items: { type: 'string' } },
          awsIamPolicyPrincipal: {
            anyOf: [
              { const: '*' },
              {
                type: 'object',
                properties: {
                  AWS: {
                    anyOf: [
                      { const: '*' },
                      { $ref: '#/definitions/awsCfIf' },
                      {
                        type: 'array',
                        items: {
                          anyOf: [
                            { $ref: '#/definitions/awsAccountId' },
                            { $ref: '#/definitions/awsArn' },
                          ],
                        },
                      },
                    ],
                  },
                  Federated: { type: 'array', items: { type: 'string' } },
                  Service: { type: 'array', items: { type: 'string' } },
                  CanonicalUser: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
              },
            ],
          },
          awsIamPolicyResource: {
            anyOf: [
              { const: '*' },
              { $ref: '#/definitions/awsArn' },
              { $ref: '#/definitions/awsLogicalResourceId' },
              {
                type: 'array',
                items: {
                  anyOf: [
                    { const: '*' },
                    { $ref: '#/definitions/awsArn' },
                    { $ref: '#/definitions/awsLogicalResourceId' },
                  ],
                },
              },
            ],
          },
          // Definition of Statement taken from https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_grammar.html#policies-grammar-bnf
          awsIamPolicyStatements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Sid: { type: 'string' },
                Effect: { enum: ['Allow', 'Deny'] },
                Action: { $ref: '#/definitions/awsIamPolicyAction' },
                NotAction: { $ref: '#/definitions/awsIamPolicyAction' },
                Principal: { $ref: '#/definitions/awsIamPolicyPrincipal' },
                NotPrincipal: { $ref: '#/definitions/awsIamPolicyPrincipal' },
                Resource: { $ref: '#/definitions/awsIamPolicyResource' },
                NotResource: { $ref: '#/definitions/awsIamPolicyResource' },
                Condition: { type: 'object' },
              },
              additionalProperties: false,
              allOf: [
                { required: ['Effect'] },
                { oneOf: [{ required: ['Action'] }, { required: ['NotAction'] }] },
                { oneOf: [{ required: ['Resource'] }, { required: ['NotResource'] }] },
              ],
            },
          },
          awsKmsArn: {
            anyOf: [
              { $ref: '#/definitions/awsCfFunction' },
              { type: 'string', pattern: '^arn:aws[a-z-]*:kms' },
            ],
          },
          awsLambdaArchitecture: { enum: ['arm64', 'x86_64'] },
          awsLambdaEnvironment: {
            type: 'object',
            patternProperties: {
              '^[A-Za-z_][a-zA-Z0-9_]*$': {
                anyOf: [
                  { const: '' },
                  { $ref: '#/definitions/awsCfInstruction' },
                  { $ref: '#/definitions/awsCfIf' },
                  { $ref: '#/definitions/awsCfSelect' },
                ],
              },
            },
            additionalProperties: false,
          },
          awsLambdaLayers: {
            type: 'array',
            items: { $ref: '#/definitions/awsArn' },
          },
          awsLambdaMemorySize: { type: 'integer', minimum: 128, maximum: 10240 },
          awsLambdaRole: {
            anyOf: [
              { type: 'string', minLength: 1 },
              { $ref: '#/definitions/awsCfSub' },
              { $ref: '#/definitions/awsCfImport' },
              { $ref: '#/definitions/awsCfGetAtt' },
            ],
          },
          awsLambdaRuntime: {
            enum: [
              'dotnet6',
              'go1.x',
              'java21',
              'java17',
              'java11',
              'java8',
              'java8.al2',
              'nodejs14.x',
              'nodejs16.x',
              'nodejs18.x',
              'nodejs20.x',
              'provided',
              'provided.al2',
              'provided.al2023',
              'python3.7',
              'python3.8',
              'python3.9',
              'python3.10',
              'python3.11',
              'ruby2.7',
              'ruby3.2',
            ],
          },
          awsLambdaRuntimeManagement: {
            oneOf: [
              { enum: ['auto', 'onFunctionUpdate'] },
              {
                type: 'object',
                properties: {
                  mode: { enum: ['auto', 'onFunctionUpdate', 'manual'] },
                  arn: { $ref: '#/definitions/awsArn' },
                },
                additionalProperties: false,
              },
            ],
          },
          awsLambdaTimeout: { type: 'integer', minimum: 1, maximum: 900 },
          awsLambdaTracing: { anyOf: [{ enum: ['Active', 'PassThrough'] }, { type: 'boolean' }] },
          awsLambdaVersioning: { type: 'boolean' },
          awsLambdaVpcConfig: {
            type: 'object',
            properties: {
              ipv6AllowedForDualStack: { type: 'boolean' },
              securityGroupIds: {
                anyOf: [
                  {
                    type: 'array',
                    items: {
                      anyOf: [
                        { $ref: '#/definitions/awsCfInstruction' },
                        { $ref: '#/definitions/awsCfIf' },
                      ],
                    },
                    maxItems: 5,
                  },
                  { $ref: '#/definitions/awsCfSplit' },
                  { $ref: '#/definitions/awsCfFindInMap' },
                ],
              },
              subnetIds: {
                anyOf: [
                  {
                    type: 'array',
                    items: {
                      anyOf: [
                        { $ref: '#/definitions/awsCfInstruction' },
                        { $ref: '#/definitions/awsCfIf' },
                      ],
                    },
                    maxItems: 16,
                  },
                  { $ref: '#/definitions/awsCfSplit' },
                  { $ref: '#/definitions/awsCfFindInMap' },
                ],
              },
            },
            additionalProperties: false,
            required: ['securityGroupIds', 'subnetIds'],
          },
          awsLogicalResourceId: {
            type: 'string',
            pattern: '^[#A-Za-z0-9-_./]+[*]?$',
          },
          awsLogGroupName: {
            type: 'string',
            pattern: '^[/#A-Za-z0-9-_.]+$',
          },
          awsLogRetentionInDays: {
            type: 'number',
            // https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutRetentionPolicy.html#API_PutRetentionPolicy_RequestSyntax
            enum: [
              1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 2192, 2557, 2922,
              3288, 3653,
            ],
          },
          awsLogDataProtectionPolicy: {
            type: 'object',
            properties: {
              Name: { type: 'string' },
              Description: { type: 'string' },
              Version: { type: 'string' },
              Statement: { type: 'array' },
            },
            additionalProperties: false,
            required: ['Name', 'Version', 'Statement'],
          },
          awsResourceCondition: { type: 'string' },
          awsResourceDependsOn: { type: 'array', items: { type: 'string' } },
          awsResourcePolicyResource: {
            anyOf: [
              { const: '*' },
              { $ref: '#/definitions/awsArn' },
              // API Gateway Resource Policy resource property abbreviated syntax - https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-resource-policies-examples.html
              { $ref: '#/definitions/awsApiGatewayAbbreviatedArn' },
              {
                type: 'array',
                items: {
                  anyOf: [
                    { const: '*' },
                    { $ref: '#/definitions/awsArn' },
                    // API Gateway Resource Policy resource property abbreviated syntax - https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-resource-policies-examples.html
                    { $ref: '#/definitions/awsApiGatewayAbbreviatedArn' },
                  ],
                },
              },
            ],
          },
          awsResourcePolicyStatements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Sid: { type: 'string' },
                Effect: { enum: ['Allow', 'Deny'] },
                Action: { $ref: '#/definitions/awsIamPolicyAction' },
                NotAction: { $ref: '#/definitions/awsIamPolicyAction' },
                Principal: { $ref: '#/definitions/awsIamPolicyPrincipal' },
                NotPrincipal: { $ref: '#/definitions/awsIamPolicyPrincipal' },
                Resource: { $ref: '#/definitions/awsResourcePolicyResource' },
                NotResource: { $ref: '#/definitions/awsResourcePolicyResource' },
                Condition: { type: 'object' },
              },
              additionalProperties: false,
              allOf: [
                { required: ['Effect'] },
                { oneOf: [{ required: ['Action'] }, { required: ['NotAction'] }] },
                { oneOf: [{ required: ['Resource'] }, { required: ['NotResource'] }] },
              ],
            },
          },
          awsResourceTags: {
            type: 'object',
            patternProperties: {
              '^(?!aws:)[\\w./=+:\\-_\\x20]{1,128}$': {
                type: 'string',
                maxLength: 256,
              },
            },
            additionalProperties: false,
          },
          awsS3BucketName: {
            type: 'string',
            // pattern sourced from https://stackoverflow.com/questions/50480924/regex-for-s3-bucket-name
            pattern:
              '(?!^(\\d{1,3}\\.){3}\\d{1,3}$)(^(([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])\\.)*([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$)',
            minLength: 3,
            maxLength: 63,
          },
          ecrImageUri: {
            type: 'string',
            pattern:
              '^\\d+\\.dkr\\.ecr\\.[a-z0-9-]+..amazonaws.com\\/([^@]+)|([^@:]+@sha256:[a-f0-9]{64})$',
          },
          filterPatterns: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: { type: 'object' },
          },
        },
        provider: {
          properties: {
            alb: {
              type: 'object',
              properties: {
                targetGroupPrefix: { type: 'string', maxLength: 16 },
                authorizers: {
                  type: 'object',
                  additionalProperties: {
                    anyOf: [oidcAlbAuthorizer, cognitoAlbAuthorizer],
                  },
                },
              },
              additionalProperties: false,
            },
            apiGateway: {
              type: 'object',
              properties: {
                apiKeys: { $ref: '#/definitions/awsApiGatewayApiKeys' },
                apiKeySourceType: {
                  anyOf: ['HEADER', 'AUTHORIZER'].map(caseInsensitive),
                },
                binaryMediaTypes: {
                  type: 'array',
                  items: { type: 'string', pattern: '^\\S+\\/\\S+$' },
                },
                description: { type: 'string' },
                disableDefaultEndpoint: { type: 'boolean' },
                metrics: { type: 'boolean' },
                minimumCompressionSize: { type: 'integer', minimum: 0, maximum: 10485760 },
                resourcePolicy: { $ref: '#/definitions/awsResourcePolicyStatements' },
                restApiId: { $ref: '#/definitions/awsCfInstruction' },
                restApiResources: {
                  anyOf: [
                    {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          path: { type: 'string' },
                          resourceId: { type: 'string' },
                        },
                        required: [],
                        additionalProperties: false,
                      },
                    },
                    { type: 'object' },
                  ],
                },
                restApiRootResourceId: { $ref: '#/definitions/awsCfInstruction' },
                request: {
                  type: 'object',
                  properties: {
                    schemas: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          schema: { type: 'object' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                        },
                        required: ['schema'],
                        additionalProperties: false,
                      },
                    },
                  },
                  additionalProperties: false,
                },
                shouldStartNameWithService: { type: 'boolean' },
                stage: { type: 'string' },
                usagePlan: {
                  anyOf: [
                    apiGatewayUsagePlan,
                    {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: apiGatewayUsagePlan,
                        maxProperties: 1,
                      },
                    },
                  ],
                },
                websocketApiId: { $ref: '#/definitions/awsCfInstruction' },
              },
              additionalProperties: false,
            },
            apiName: { type: 'string' },
            architecture: { $ref: '#/definitions/awsLambdaArchitecture' },
            cfnRole: { $ref: '#/definitions/awsArn' },
            cloudFront: {
              type: 'object',
              properties: {
                cachePolicies: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      Comment: { type: 'string' },
                      DefaultTTL: { type: 'integer', minimum: 0 },
                      MaxTTL: { type: 'integer', minimum: 0 },
                      MinTTL: { type: 'integer', minimum: 0 },
                      ParametersInCacheKeyAndForwardedToOrigin: {
                        type: 'object',
                        properties: {
                          CookiesConfig: {
                            type: 'object',
                            properties: {
                              CookieBehavior: { enum: ['none', 'whitelist', 'allExcept', 'all'] },
                              Cookies: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['CookieBehavior'],
                            additionalProperties: false,
                          },
                          EnableAcceptEncodingBrotli: { type: 'boolean' },
                          EnableAcceptEncodingGzip: { type: 'boolean' },
                          HeadersConfig: {
                            type: 'object',
                            properties: {
                              HeaderBehavior: { enum: ['none', 'whitelist'] },
                              Headers: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['HeaderBehavior'],
                            additionalProperties: false,
                          },
                          QueryStringsConfig: {
                            type: 'object',
                            properties: {
                              QueryStringBehavior: {
                                enum: ['none', 'whitelist', 'allExcept', 'all'],
                              },
                              QueryStrings: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['QueryStringBehavior'],
                            additionalProperties: false,
                          },
                        },
                        required: [
                          'CookiesConfig',
                          'EnableAcceptEncodingGzip',
                          'HeadersConfig',
                          'QueryStringsConfig',
                        ],
                        additionalProperties: false,
                      },
                    },
                    required: [
                      'DefaultTTL',
                      'MaxTTL',
                      'MinTTL',
                      'ParametersInCacheKeyAndForwardedToOrigin',
                    ],
                    additionalProperties: false,
                  },
                },
              },
              additionalProperties: false,
            },
            deploymentBucket: {
              anyOf: [
                { $ref: '#/definitions/awsS3BucketName' },
                {
                  type: 'object',
                  properties: {
                    blockPublicAccess: { type: 'boolean' },
                    skipPolicySetup: { type: 'boolean' },
                    maxPreviousDeploymentArtifacts: { type: 'integer', minimum: 0 },
                    name: { $ref: '#/definitions/awsS3BucketName' },
                    versioning: { type: 'boolean' },
                    serverSideEncryption: { enum: ['AES256', 'aws:kms'] },
                    sseCustomerAlgorithim: { type: 'string' },
                    sseCustomerKey: { type: 'string' },
                    sseCustomerKeyMD5: { type: 'string' },
                    sseKMSKeyId: { type: 'string' },
                    tags: { $ref: '#/definitions/awsResourceTags' },
                  },
                  additionalProperties: false,
                },
              ],
            },
            deploymentPrefix: { type: 'string' },
            disableRollback: { type: 'boolean' },
            endpointType: {
              anyOf: ['REGIONAL', 'EDGE', 'PRIVATE'].map(caseInsensitive),
            },
            environment: { $ref: '#/definitions/awsLambdaEnvironment' },
            eventBridge: {
              type: 'object',
              properties: {
                useCloudFormation: { type: 'boolean' },
              },
              additionalProperties: false,
            },
            httpApi: {
              type: 'object',
              properties: {
                authorizers: {
                  type: 'object',
                  additionalProperties: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          type: { const: 'jwt' },
                          name: { type: 'string' },
                          identitySource: { $ref: '#/definitions/awsCfInstruction' },
                          issuerUrl: { $ref: '#/definitions/awsCfInstruction' },
                          audience: {
                            anyOf: [
                              { $ref: '#/definitions/awsCfInstruction' },
                              {
                                type: 'array',
                                items: { $ref: '#/definitions/awsCfInstruction' },
                              },
                            ],
                          },
                        },
                        required: ['identitySource', 'issuerUrl', 'audience'],
                        additionalProperties: false,
                      },
                      {
                        type: 'object',
                        properties: {
                          type: { const: 'request' },
                          name: { type: 'string' },
                          functionName: { type: 'string' },
                          functionArn: { $ref: '#/definitions/awsCfInstruction' },
                          managedExternally: { type: 'boolean' },
                          resultTtlInSeconds: { type: 'integer', minimum: 0, maximum: 3600 },
                          enableSimpleResponses: { type: 'boolean' },
                          payloadVersion: { $ref: '#/definitions/awsHttpApiPayload' },
                          identitySource: {
                            anyOf: [
                              { $ref: '#/definitions/awsCfInstruction' },
                              {
                                type: 'array',
                                items: { $ref: '#/definitions/awsCfInstruction' },
                              },
                            ],
                          },
                        },
                        required: ['type'],
                      },
                    ],
                  },
                },
                cors: {
                  anyOf: [
                    { type: 'boolean' },
                    {
                      type: 'object',
                      properties: {
                        allowCredentials: { type: 'boolean' },
                        allowedHeaders: { type: 'array', items: { type: 'string' } },
                        allowedMethods: { type: 'array', items: { type: 'string' } },
                        allowedOrigins: { type: 'array', items: { type: 'string' } },
                        exposedResponseHeaders: { type: 'array', items: { type: 'string' } },
                        maxAge: { type: 'integer', minimum: 0 },
                      },
                      additionalProperties: false,
                    },
                  ],
                },
                id: {
                  anyOf: [
                    { type: 'string' },
                    { $ref: '#/definitions/awsCfImportLocallyResolvable' },
                  ],
                },
                name: { type: 'string' },
                payload: { type: 'string' },
                metrics: { type: 'boolean' },
                useProviderTags: { const: true },
                disableDefaultEndpoint: { type: 'boolean' },
                shouldStartNameWithService: { type: 'boolean' },
              },
              additionalProperties: false,
            },
            iam: {
              type: 'object',
              properties: {
                role: {
                  anyOf: [
                    { $ref: '#/definitions/awsLambdaRole' },
                    {
                      type: 'object',
                      properties: {
                        name: {
                          type: 'string',
                          pattern: '^[A-Za-z0-9/_+=,.@-]{1,64}$',
                        },
                        path: {
                          type: 'string',
                          pattern: '(^\\/$)|(^\\/[\u0021-\u007f]+\\/$)',
                        },
                        managedPolicies: {
                          type: 'array',
                          items: { $ref: '#/definitions/awsArn' },
                        },
                        statements: { $ref: '#/definitions/awsIamPolicyStatements' },
                        permissionBoundary: { $ref: '#/definitions/awsArn' },
                        permissionsBoundary: { $ref: '#/definitions/awsArn' },
                        tags: { $ref: '#/definitions/awsResourceTags' },
                      },
                      additionalProperties: false,
                    },
                  ],
                },
                deploymentRole: { $ref: '#/definitions/awsArn' },
              },
              additionalProperties: false,
            },
            iamManagedPolicies: { type: 'array', items: { $ref: '#/definitions/awsArn' } },
            iamRoleStatements: { $ref: '#/definitions/awsIamPolicyStatements' },
            ecr: {
              type: 'object',
              properties: {
                scanOnPush: { type: 'boolean' },
                images: {
                  type: 'object',
                  patternProperties: {
                    [imageNamePattern]: {
                      anyOf: [
                        {
                          type: 'object',
                          properties: {
                            uri: { $ref: '#/definitions/ecrImageUri' },
                            path: { type: 'string' },
                            file: { type: 'string' },
                            buildArgs: { type: 'object', additionalProperties: { type: 'string' } },
                            cacheFrom: { type: 'array', items: { type: 'string' } },
                            platform: { type: 'string' },
                          },
                          additionalProperties: false,
                        },
                        {
                          type: 'string',
                        },
                      ],
                    },
                  },
                },
              },
              required: ['images'],
              additionalProperties: false,
            },
            kmsKeyArn: { $ref: '#/definitions/awsKmsArn' },
            lambdaHashingVersion: {
              type: 'string',
              enum: ['20200924', '20201221'],
            },
            layers: { $ref: '#/definitions/awsLambdaLayers' },
            logRetentionInDays: {
              $ref: '#/definitions/awsLogRetentionInDays',
            },
            logDataProtectionPolicy: {
              $ref: '#/definitions/awsLogDataProtectionPolicy',
            },
            logs: {
              type: 'object',
              properties: {
                frameworkLambda: { type: 'boolean' },
                httpApi: {
                  anyOf: [
                    { type: 'boolean' },
                    {
                      type: 'object',
                      properties: {
                        format: { type: 'string' },
                      },
                      additionalProperties: false,
                    },
                  ],
                },
                restApi: {
                  anyOf: [
                    { type: 'boolean' },
                    {
                      type: 'object',
                      properties: {
                        accessLogging: { type: 'boolean' },
                        executionLogging: { type: 'boolean' },
                        format: { type: 'string' },
                        fullExecutionData: { type: 'boolean' },
                        level: { enum: ['INFO', 'ERROR'] },
                        role: { $ref: '#/definitions/awsArn' },
                        roleManagedExternally: { type: 'boolean' },
                      },
                      additionalProperties: false,
                    },
                  ],
                },
                websocket: {
                  anyOf: [
                    { type: 'boolean' },
                    {
                      type: 'object',
                      properties: {
                        accessLogging: { type: 'boolean' },
                        executionLogging: { type: 'boolean' },
                        format: { type: 'string' },
                        fullExecutionData: { type: 'boolean' },
                        level: { enum: ['INFO', 'ERROR'] },
                      },
                      additionalProperties: false,
                    },
                  ],
                },
              },
            },
            memorySize: { $ref: '#/definitions/awsLambdaMemorySize' },
            notificationArns: { type: 'array', items: { $ref: '#/definitions/awsArnString' } },
            profile: { type: 'string' },
            region: {
              enum: [
                'us-east-1',
                'us-east-2',
                'us-gov-east-1',
                'us-gov-west-1',
                'us-iso-east-1',
                'us-iso-west-1',
                'us-isob-east-1',
                'us-west-1',
                'us-west-2',
                'af-south-1',
                'ap-east-1',
                'ap-northeast-1',
                'ap-northeast-2',
                'ap-northeast-3',
                'ap-south-1',
                'ap-south-2',
                'ap-southeast-1',
                'ap-southeast-2',
                'ap-southeast-3',
                'ap-southeast-4',
                'ca-central-1',
                'cn-north-1',
                'cn-northwest-1',
                'eu-central-1',
                'eu-central-2',
                'eu-north-1',
                'eu-south-1',
                'eu-south-2',
                'eu-west-1',
                'eu-west-2',
                'eu-west-3',
                'il-central-1',
                'me-central-1',
                'me-south-1',
                'sa-east-1',
              ],
            },
            role: { $ref: '#/definitions/awsLambdaRole' },
            rolePermissionsBoundary: { $ref: '#/definitions/awsArnString' },
            rollbackConfiguration: {
              type: 'object',
              properties: {
                RollbackTriggers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      Arn: { $ref: '#/definitions/awsArnString' },
                      Type: { const: 'AWS::CloudWatch::Alarm' },
                    },
                    additionalProperties: false,
                    required: ['Arn', 'Type'],
                  },
                },
                MonitoringTimeInMinutes: { type: 'integer', minimum: 0 },
              },
              additionalProperties: false,
            },
            runtime: { $ref: '#/definitions/awsLambdaRuntime' },
            runtimeManagement: { $ref: '#/definitions/awsLambdaRuntimeManagement' },
            deploymentMethod: { enum: ['changesets', 'direct'] },
            s3: {
              type: 'object',
              additionalProperties: require('./package/compile/events/s3/config-schema'),
            },
            stage: { $ref: '#/definitions/stage' },
            stackName: {
              type: 'string',
              pattern: '^[a-zA-Z][a-zA-Z0-9-]*$',
              maxLength: 128,
            },
            stackParameters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ParameterKey: { type: 'string' },
                  ParameterValue: { type: 'string' },
                  UsePreviousValue: { type: 'boolean' },
                  ResolvedValue: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
            stackPolicy: { $ref: '#/definitions/awsIamPolicyStatements' },
            stackTags: { $ref: '#/definitions/awsResourceTags' },
            tags: { $ref: '#/definitions/awsResourceTags' },
            timeout: { $ref: '#/definitions/awsLambdaTimeout' },
            tracing: {
              type: 'object',
              properties: {
                apiGateway: { type: 'boolean' },
                lambda: { $ref: '#/definitions/awsLambdaTracing' },
              },
              additionalProperties: false,
            },
            vpc: { $ref: '#/definitions/awsLambdaVpcConfig' },
            vpcEndpointIds: { $ref: '#/definitions/awsCfArrayInstruction' },
            versionFunctions: { $ref: '#/definitions/awsLambdaVersioning' },
            websocket: {
              type: 'object',
              properties: {
                useProviderTags: { type: 'boolean' },
              },
              additionalProperties: false,
            },
            websocketsApiName: { type: 'string' },
            kinesis: {
              type: 'object',
              properties: {
                consumerNamingMode: { const: 'serviceSpecific' },
              },
              additionalProperties: false,
            },
            websocketsApiRouteSelectionExpression: { type: 'string' },
            websocketsDescription: { type: 'string' },
          },
        },
        function: {
          properties: {
            architecture: { $ref: '#/definitions/awsLambdaArchitecture' },
            awsKmsKeyArn: { $ref: '#/definitions/awsKmsArn' },
            condition: { $ref: '#/definitions/awsResourceCondition' },
            dependsOn: { $ref: '#/definitions/awsResourceDependsOn' },
            description: { type: 'string', maxLength: 256 },
            destinations: {
              type: 'object',
              properties: {
                onSuccess: {
                  anyOf: [
                    { type: 'string', minLength: 1 },
                    {
                      type: 'object',
                      properties: {
                        arn: { $ref: '#/definitions/awsCfFunction' },
                        type: { enum: ['function', 'sns', 'sqs', 'eventBus'] },
                      },
                      additionalProperties: false,
                      required: ['arn', 'type'],
                    },
                  ],
                },
                onFailure: {
                  anyOf: [
                    { type: 'string', minLength: 1 },
                    {
                      type: 'object',
                      properties: {
                        arn: { $ref: '#/definitions/awsCfFunction' },
                        type: { enum: ['function', 'sns', 'sqs', 'eventBus'] },
                      },
                      additionalProperties: false,
                      required: ['arn', 'type'],
                    },
                  ],
                },
              },
              additionalProperties: false,
            },
            disableLogs: { type: 'boolean' },
            environment: { $ref: '#/definitions/awsLambdaEnvironment' },
            ephemeralStorageSize: { type: 'integer', minimum: 512, maximum: 10240 },
            fileSystemConfig: {
              type: 'object',
              properties: {
                arn: {
                  anyOf: [
                    {
                      type: 'string',
                      pattern:
                        '^arn:aws[a-zA-Z-]*:elasticfilesystem:[a-z]{2}((-gov)|(-iso(b?)))?-[a-z]+-[1-9]{1}:[0-9]{12}:access-point/fsap-[a-f0-9]{17}$',
                    },
                    { $ref: '#/definitions/awsCfGetAtt' },
                    { $ref: '#/definitions/awsCfJoin' },
                    { $ref: '#/definitions/awsCfImport' },
                  ],
                },
                localMountPath: { type: 'string', pattern: '^/mnt/[a-zA-Z0-9-_.]+$' },
              },
              additionalProperties: false,
              required: ['localMountPath', 'arn'],
            },
            handler: { type: 'string' },
            image: {
              anyOf: [
                { $ref: '#/definitions/ecrImageUri' },
                {
                  type: 'string',
                  pattern: imageNamePattern,
                },
                {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      pattern: imageNamePattern,
                    },
                    uri: { $ref: '#/definitions/ecrImageUri' },
                    workingDirectory: {
                      type: 'string',
                    },
                    command: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                    entryPoint: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                  additionalProperties: false,
                },
              ],
            },
            kmsKeyArn: { $ref: '#/definitions/awsKmsArn' },
            snapStart: { type: 'boolean' },
            layers: { $ref: '#/definitions/awsLambdaLayers' },
            logRetentionInDays: {
              $ref: '#/definitions/awsLogRetentionInDays',
            },
            logDataProtectionPolicy: {
              $ref: '#/definitions/awsLogDataProtectionPolicy',
            },
            maximumEventAge: { type: 'integer', minimum: 60, maximum: 21600 },
            maximumRetryAttempts: { type: 'integer', minimum: 0, maximum: 2 },
            memorySize: { $ref: '#/definitions/awsLambdaMemorySize' },
            onError: {
              anyOf: [
                { type: 'string', pattern: '^arn:aws[a-z-]*:sns' },
                { $ref: '#/definitions/awsCfFunction' },
              ],
            },
            package: {
              type: 'object',
              properties: {
                artifact: { type: 'string' },
                exclude: { type: 'array', items: { type: 'string' } },
                include: { type: 'array', items: { type: 'string' } },
                individually: { type: 'boolean' },
                patterns: { type: 'array', items: { type: 'string' } },
              },
              additionalProperties: false,
            },
            provisionedConcurrency: cfValue({ type: 'integer', minimum: 0 }),
            reservedConcurrency: cfValue({ type: 'integer', minimum: 0 }),
            role: { $ref: '#/definitions/awsLambdaRole' },
            runtime: { $ref: '#/definitions/awsLambdaRuntime' },
            runtimeManagement: { $ref: '#/definitions/awsLambdaRuntimeManagement' },
            tags: { $ref: '#/definitions/awsResourceTags' },
            timeout: { $ref: '#/definitions/awsLambdaTimeout' },
            tracing: { $ref: '#/definitions/awsLambdaTracing' },
            url: {
              anyOf: [
                { type: 'boolean' },
                {
                  type: 'object',
                  properties: {
                    authorizer: { type: 'string', enum: ['aws_iam'] },
                    cors: {
                      anyOf: [
                        { type: 'boolean' },
                        {
                          type: 'object',
                          properties: {
                            allowCredentials: { type: 'boolean' },
                            allowedHeaders: {
                              type: 'array',
                              minItems: 1,
                              maxItems: 100,
                              items: { type: 'string' },
                            },
                            allowedMethods: {
                              type: 'array',
                              minItems: 1,
                              maxItems: 6,
                              items: { type: 'string' },
                            },
                            allowedOrigins: {
                              type: 'array',
                              minItems: 1,
                              maxItems: 100,
                              items: { type: 'string' },
                            },
                            exposedResponseHeaders: {
                              type: 'array',
                              minItems: 1,
                              maxItems: 100,
                              items: { type: 'string' },
                            },
                            maxAge: { type: 'integer', minimum: 0 },
                          },
                          additionalProperties: false,
                        },
                      ],
                    },
                    invokeMode: {
                      type: 'string',
                      enum: ['BUFFERED', 'RESPONSE_STREAM'],
                    },
                  },
                  additionalProperties: false,
                },
              ],
            },
            versionFunction: { $ref: '#/definitions/awsLambdaVersioning' },
            vpc: { $ref: '#/definitions/awsLambdaVpcConfig' },
            httpApi: {
              type: 'object',
              properties: {
                payload: { $ref: '#/definitions/awsHttpApiPayload' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        layers: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              allowedAccounts: {
                type: 'array',
                items: {
                  type: 'string',
                  pattern: '^(\\d{12}|\\*|arn:(aws[a-zA-Z-]*):iam::\\d{12}:root)$',
                },
              },
              compatibleArchitectures: {
                type: 'array',
                items: { $ref: '#/definitions/awsLambdaArchitecture' },
                maxItems: 2,
              },
              compatibleRuntimes: {
                type: 'array',
                items: { $ref: '#/definitions/awsLambdaRuntime' },
                maxItems: 15,
              },
              description: { type: 'string', maxLength: 256 },
              licenseInfo: { type: 'string', maxLength: 512 },
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 140,
                pattern:
                  '^((arn:[a-zA-Z0-9-]+:lambda:[a-zA-Z0-9-]+:\\d{12}:layer:[a-zA-Z0-9-_]+)|[a-zA-Z0-9-_]+)$',
              },
              package: {
                type: 'object',
                properties: {
                  artifact: { type: 'string' },
                  exclude: { type: 'array', items: { type: 'string' } },
                  include: { type: 'array', items: { type: 'string' } },
                  patterns: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
              },
              path: { type: 'string' },
              retain: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
        resources: {
          type: 'object',
          properties: {
            AWSTemplateFormatVersion: {
              type: 'string',
            },
            Conditions: {
              type: 'object',
            },
            Description: {
              type: 'string',
            },
            Mappings: {
              type: 'object',
            },
            Metadata: {
              type: 'object',
            },
            // According to https://s3.amazonaws.com/cfn-resource-specifications-us-east-1-prod/schemas/2.15.0/all-spec.json
            // `Outputs` is just an "object", though it seems like this is under-specifying that section a bit.
            // See also https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html
            Outputs: {
              type: 'object',
            },
            Parameters: {
              type: 'object',
            },
            // Not replicating the full JSON schema from https://s3.amazonaws.com/cfn-resource-specifications-us-east-1-prod/schemas/2.15.0/all-spec.json
            // as that gets into the specifics for each resource type.
            //
            // The only required attribute is `Type`; `Properties` and other common attributes are optional.
            // See also https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resources-section-structure.html
            Resources: {
              type: 'object',
              properties: {
                'Fn::Transform': {
                  type: 'object',
                  properties: {
                    Name: { type: 'string' },
                    Parameters: { type: 'object' },
                  },
                  required: ['Name'],
                  additionalProperties: false,
                },
              },
              patternProperties: {
                '^[a-zA-Z0-9]{1,255}$': {
                  type: 'object',
                  properties: {
                    Type: { type: 'string' },
                    Properties: { type: 'object' },
                    CreationPolicy: { type: 'object' },
                    DeletionPolicy: { type: 'string' },
                    DependsOn: { $ref: '#/definitions/awsResourceDependsOn' },
                    Metadata: { type: 'object' },
                    UpdatePolicy: { type: 'object' },
                    UpdateReplacePolicy: { type: 'string' },
                    Condition: { $ref: '#/definitions/awsResourceCondition' },
                  },
                  required: ['Type'],
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
            Transform: {
              type: 'array',
              items: { type: 'string' },
            },
            extensions: {
              type: 'object',
              patternProperties: {
                // names have the same restrictions as CloudFormation Resources section
                '^[a-zA-Z0-9]{1,255}$': {
                  type: 'object',
                  // this lists the supported properties, other properties are "Not supported. An error will be thrown
                  // if you try to extend an unsupported attribute."
                  // this is different than the above schema for `Resources`, which allows the `Type` attribute.
                  // extensions are explicitly meant to extend the definition of existing resources.
                  properties: {
                    Properties: { type: 'object' },
                    CreationPolicy: { type: 'object' },
                    DeletionPolicy: { type: 'string' },
                    DependsOn: { $ref: '#/definitions/awsResourceDependsOn' },
                    Metadata: { type: 'object' },
                    UpdatePolicy: { type: 'object' },
                    UpdateReplacePolicy: { type: 'string' },
                    Condition: { $ref: '#/definitions/awsResourceCondition' },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      });
    }
    // Store credentials in this variable to avoid creating them several times (messes up MFA).
    this.cachedCredentials = null;

    // Store accountId to be used in `generateTelemetry` logic
    this.accountId = null;

    Object.assign(this.naming, naming);
  }

  static getProviderName() {
    return constants.providerName;
  }

  /**
   * Execute an AWS request by calling the AWS SDK
   * @param {string} service - Service name
   * @param {string} method - Method name
   * @param {Object} params - Parameters
   * @param {Object} [options] - Options to modify the request behavior
   * @prop [options.useCache] - Utilize cache to retrieve results
   * @prop [options.region] - Specify when to request to different region
   */
  async request(service, method, params, options) {
    // TODO: Determine calling module and log that
    const requestOptions = _.isObject(options) ? options : {};
    const shouldCache = _.get(requestOptions, 'useCache', false);
    // Copy is required as the credentials may be modified during the request
    const credentials = Object.assign({}, this.getCredentials());
    const serviceOptions = {
      name: service,
      params: {
        ...credentials,
        region: _.get(requestOptions, 'region', this.getRegion()),
        isS3TransferAccelerationEnabled: this.isS3TransferAccelerationEnabled(),
      },
    };
    return (shouldCache ? awsRequest.memoized : awsRequest)(serviceOptions, method, params);
  }

  /**
   * Fetch credentials directly or using a profile from serverless yml configuration or from the
   * well known environment variables
   * @returns {{region: *}}
   */
  getCredentials() {
    if (this.cachedCredentials) {
      // We have already created the credentials object once, so return it.
      return this.cachedCredentials;
    }
    const result = {};
    const stageUpper = this.getStage() ? this.getStage().toUpperCase() : null;

    // add specified credentials, overriding with more specific declarations
    const awsDefaultProfile = process.env.AWS_DEFAULT_PROFILE || 'default';
    try {
      impl.addProfileCredentials(result, awsDefaultProfile);
    } catch (err) {
      if (err.code !== 'UNRECOGNIZED_AWS_PROFILE') throw err;
    }
    if (this.serverless.service.provider.profile && !this.options['aws-profile']) {
      // config profile
      impl.addProfileCredentials(result, this.serverless.service.provider.profile);
    }
    impl.addEnvironmentCredentials(result, 'AWS'); // creds for all stages
    impl.addEnvironmentProfile(result, 'AWS');
    impl.addEnvironmentCredentials(result, `AWS_${stageUpper}`); // stage specific creds
    impl.addEnvironmentProfile(result, `AWS_${stageUpper}`);
    if (this.options['aws-profile']) {
      impl.addProfileCredentials(result, this.options['aws-profile']); // CLI option profile
    }

    const deploymentBucketObject = this.serverless.service.provider.deploymentBucketObject;
    if (
      deploymentBucketObject &&
      deploymentBucketObject.serverSideEncryption &&
      deploymentBucketObject.serverSideEncryption === 'aws:kms'
    ) {
      result.signatureVersion = 'v4';
    }

    // Store the credentials to avoid creating them again (messes up MFA).
    this.cachedCredentials = result;
    return result;
  }

  // This function will be used to block the addition of transfer acceleration options
  // to the cloudformation template for regions where acceleration is not supported (ie, govcloud)
  isS3TransferAccelerationSupported() {
    // Only enable s3 transfer acceleration for standard regions (non govcloud/china)
    // since those regions do not yet support it
    const endpoint = getS3EndpointForRegion(this.getRegion());
    return endpoint === 's3.amazonaws.com';
  }

  isS3TransferAccelerationEnabled() {
    return !!this.options['aws-s3-accelerate'];
  }

  isS3TransferAccelerationDisabled() {
    return this.options['aws-s3-accelerate'] === false;
  }

  disableTransferAccelerationForCurrentDeploy() {
    delete this.options['aws-s3-accelerate'];
  }

  getValues(source, objectPaths) {
    return objectPaths.map((objectPath) => ({
      path: objectPath,
      value: _.get(source, objectPath.join('.')),
    }));
  }

  firstValue(values) {
    return values.reduce((result, current) => {
      return result.value ? result : current;
    }, {});
  }

  getRegionSourceValue() {
    const values = this.getValues(this, [
      ['options', 'region'],
      ['serverless', 'config', 'region'],
      ['serverless', 'service', 'provider', 'region'],
    ]);
    return this.firstValue(values);
  }

  getRegion() {
    const defaultRegion = 'us-east-1';
    const regionSourceValue = this.getRegionSourceValue();
    return regionSourceValue.value || defaultRegion;
  }

  getRuntimeSourceValue() {
    const values = this.getValues(this, [['serverless', 'service', 'provider', 'runtime']]);
    return this.firstValue(values);
  }

  getRuntime(runtime) {
    const defaultRuntime = 'nodejs16.x';
    const runtimeSourceValue = this.getRuntimeSourceValue();
    return runtime || runtimeSourceValue.value || defaultRuntime;
  }

  resolveFunctionRuntimeManagement(functionRuntimeManagement) {
    return {
      mode: 'auto',
      ...resolveRuntimeManagement(this.serverless.service.provider.runtimeManagement),
      ...resolveRuntimeManagement(functionRuntimeManagement),
    };
  }

  getProfileSourceValue() {
    const values = this.getValues(this, [
      ['options', 'aws-profile'],
      ['options', 'profile'],
      ['serverless', 'config', 'profile'],
      ['serverless', 'service', 'provider', 'profile'],
    ]);
    const firstVal = this.firstValue(values);
    return firstVal ? firstVal.value : null;
  }

  getProfile() {
    return this.getProfileSourceValue();
  }

  async getServerlessDeploymentBucketName() {
    if (this.serverless.service.provider.deploymentBucket) {
      return BbPromise.resolve(this.serverless.service.provider.deploymentBucket);
    }
    return this.request('CloudFormation', 'describeStackResource', {
      StackName: this.naming.getStackName(),
      LogicalResourceId: this.naming.getDeploymentBucketLogicalId(),
    }).then((result) => result.StackResourceDetail.PhysicalResourceId);
  }

  getDeploymentPrefix() {
    const provider = this.serverless.service.provider;
    if (provider.deploymentPrefix === null || provider.deploymentPrefix === undefined) {
      return 'serverless';
    }
    return `${provider.deploymentPrefix}`;
  }

  getCustomDeploymentRole() {
    const { provider } = this.serverless.service;

    return _.get(provider, 'iam.deploymentRole', provider.cfnRole);
  }

  // Check if role is provided as a string or a CF function reference to existing role
  isExistingRoleProvided(role) {
    return (
      typeof role === 'string' ||
      (_.isObject(role) && Object.keys(role).some((key) => key.includes('::')))
    );
  }

  getCustomExecutionRole(functionObj) {
    const { provider } = this.serverless.service;

    if (functionObj.role) return functionObj.role;

    const role = _.get(provider, 'iam.role');

    if (this.isExistingRoleProvided(role)) return role;

    return provider.role;
  }

  resolveFunctionArn(functionAddress) {
    if (isLambdaArn(functionAddress)) return functionAddress;
    const functionData = this.serverless.service.getFunction(functionAddress);
    if (functionData) {
      const logicalId = this.naming.getLambdaLogicalId(functionAddress);
      const alias = functionData.targetAlias;
      const arnGetter = { 'Fn::GetAtt': [logicalId, 'Arn'] };
      if (!alias) return arnGetter;
      return { 'Fn::Join': [':', [arnGetter, alias.name]] };
    }
    throw new ServerlessError(
      `Unrecognized function address ${functionAddress}`,
      'UNRECOGNIZED_FUNCTION_ADDRESS'
    );
  }

  resolveLayerArtifactName(layerName) {
    const serverlessLayerObject = this.serverless.service.getLayer(layerName);
    return serverlessLayerObject.package && serverlessLayerObject.package.artifact
      ? serverlessLayerObject.package.artifact
      : path.join(
          this.serverless.serviceDir,
          '.serverless',
          this.provider.naming.getLayerArtifactName(layerName)
        );
  }

  resolveFunctionIamRoleResourceName(functionObj) {
    const customRole = this.getCustomExecutionRole(functionObj);
    if (customRole) {
      if (typeof customRole === 'string') {
        // check whether the custom role is an ARN
        if (customRole.includes(':')) return null;
        return customRole;
      }
      if (
        // otherwise, check if we have an in-service reference to a role ARN
        customRole['Fn::GetAtt'] &&
        Array.isArray(customRole['Fn::GetAtt']) &&
        customRole['Fn::GetAtt'].length === 2 &&
        typeof customRole['Fn::GetAtt'][0] === 'string' &&
        typeof customRole['Fn::GetAtt'][1] === 'string' &&
        customRole['Fn::GetAtt'][1] === 'Arn'
      ) {
        return customRole['Fn::GetAtt'][0];
      }
      if (
        // otherwise, check if we have an import, parameters ref or sub
        customRole['Fn::ImportValue'] ||
        customRole.Ref ||
        customRole['Fn::Sub']
      ) {
        return null;
      }
    }
    return 'IamRoleLambdaExecution';
  }

  getAlbTargetGroupPrefix() {
    const provider = this.serverless.service.provider;
    if (!provider.alb || !provider.alb.targetGroupPrefix) {
      return '';
    }

    return provider.alb.targetGroupPrefix;
  }

  getLogRetentionInDays() {
    return this.serverless.service.provider.logRetentionInDays;
  }

  getLogDataProtectionPolicy() {
    return this.serverless.service.provider.logDataProtectionPolicy;
  }

  getStageSourceValue() {
    const values = this.getValues(this, [
      ['options', 'stage'],
      ['serverless', 'config', 'stage'],
      ['serverless', 'service', 'provider', 'stage'],
    ]);
    return this.firstValue(values);
  }

  getStage() {
    const defaultStage = 'dev';
    const stageSourceValue = this.getStageSourceValue();
    return stageSourceValue.value || defaultStage;
  }

  getApiGatewayStage() {
    const apiGatewayConfig = this.serverless.service.provider.apiGateway;
    return (apiGatewayConfig && apiGatewayConfig.stage) || this.getStage();
  }

  /**
   * Get API Gateway Rest API ID from serverless config
   */
  getApiGatewayRestApiId() {
    if (
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.restApiId
    ) {
      return this.serverless.service.provider.apiGateway.restApiId;
    }

    return { Ref: this.naming.getRestApiLogicalId() };
  }

  getApiGatewayDescription() {
    if (
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.description
    ) {
      return this.serverless.service.provider.apiGateway.description;
    }
    return undefined;
  }

  /**
   * Get Rest API Root Resource ID from serverless config
   */
  getApiGatewayRestApiRootResourceId() {
    if (
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.restApiRootResourceId
    ) {
      return this.serverless.service.provider.apiGateway.restApiRootResourceId;
    }
    return { 'Fn::GetAtt': [this.naming.getRestApiLogicalId(), 'RootResourceId'] };
  }

  /**
   * Get Rest API Predefined Resources from serverless config
   */
  getApiGatewayPredefinedResources() {
    if (
      !this.serverless.service.provider.apiGateway ||
      !this.serverless.service.provider.apiGateway.restApiResources
    ) {
      return [];
    }

    if (Array.isArray(this.serverless.service.provider.apiGateway.restApiResources)) {
      return this.serverless.service.provider.apiGateway.restApiResources;
    }

    return Object.keys(this.serverless.service.provider.apiGateway.restApiResources).map((key) => ({
      path: key,
      resourceId: this.serverless.service.provider.apiGateway.restApiResources[key],
    }));
  }

  /**
   * Get API Gateway websocket API ID from serverless config
   */
  getApiGatewayWebsocketApiId() {
    if (
      this.serverless.service.provider.apiGateway &&
      this.serverless.service.provider.apiGateway.websocketApiId
    ) {
      return this.serverless.service.provider.apiGateway.websocketApiId;
    }

    return { Ref: this.naming.getWebsocketsApiLogicalId() };
  }

  getStackResources(next, resourcesParam) {
    let resources = resourcesParam;
    const params = {
      StackName: this.naming.getStackName(),
    };
    if (!resources) resources = [];
    if (next) params.NextToken = next;

    return this.request('CloudFormation', 'listStackResources', params).then((res) => {
      const allResources = resources.concat(res.StackResourceSummaries);
      if (!res.NextToken) {
        return allResources;
      }
      return this.getStackResources(res.NextToken, allResources);
    });
  }

  async dockerPushToEcr(remoteTag, options = {}) {
    const pushDockerArgs = ['push', remoteTag];
    try {
      const { stdBuffer: pushDockerStdBuffer } = await spawnExt('docker', pushDockerArgs);
      if (pushDockerStdBuffer) {
        log.info(pushDockerStdBuffer.toString().trimRight());
      }
      return pushDockerStdBuffer.toString();
    } catch (err) {
      if (
        !options.isLoggedIn &&
        err.stdBuffer &&
        (err.stdBuffer.includes('no basic auth credentials') ||
          err.stdBuffer.includes('authorization token has expired'))
      ) {
        await this.dockerLoginToEcr();
        return await this.dockerPushToEcr(remoteTag, { isLoggedIn: true });
      }
      throw new ServerlessError(
        `Encountered error during executing: docker ${pushDockerArgs}\nOutput of the command:\n${err.stdBuffer}`,
        'DOCKER_PUSH_ERROR'
      );
    }
  }
}

Object.defineProperties(
  AwsProvider.prototype,
  memoizeeMethods({
    getAccountInfo: d(
      async function () {
        const result = await this.request('STS', 'getCallerIdentity', {});
        const arn = result.Arn;
        const accountId = result.Account;
        const partition = arn.split(':')[1]; // ex: arn:aws:iam:acctId:user/xyz
        return {
          accountId,
          partition,
          arn: result.Arn,
          userId: result.UserId,
        };
      },
      { promise: true }
    ),
    getAccountId: d(
      async function () {
        const result = await this.getAccountInfo();
        return result.accountId;
      },
      { promise: true }
    ),
    ensureDockerIsAvailable: d(
      async () => {
        try {
          await spawnExt('docker', ['--version']);
        } catch (err) {
          throw new ServerlessError(
            'Could not find Docker installation. Ensure Docker is installed before continuing.',
            'DOCKER_COMMAND_NOT_AVAILABLE'
          );
        }
      },
      { promise: true }
    ),
    dockerLoginToEcr: d(
      async function () {
        const registryId = await this.getAccountId();
        const result = await this.request('ECR', 'getAuthorizationToken', {
          registryIds: [registryId],
        });
        const { authorizationToken, proxyEndpoint } = result.authorizationData[0];
        const decodedAuthToken = Buffer.from(authorizationToken, 'base64').toString().split(':')[1];
        const dockerArgs = [
          'login',
          '--username',
          'AWS',
          '--password',
          decodedAuthToken,
          proxyEndpoint,
        ];
        try {
          const { stdBuffer } = await spawnExt('docker', dockerArgs);
          log.info('Login to Docker succeeded!');
          if (stdBuffer.includes('password will be stored unencrypted')) {
            log.warning(
              'Docker authentication token will be stored unencrypted in docker config. Configure Docker credential helper to remove this warning.'
            );
          }
        } catch (err) {
          throw new ServerlessError(
            `Encountered error during executing: docker ${dockerArgs.join(
              ' '
            )}\nOutput of the command:\n${err.stdBuffer}`,
            'DOCKER_LOGIN_ERROR'
          );
        }
      },
      { promise: true }
    ),
    getOrCreateEcrRepository: d(
      async function (scanOnPush) {
        const registryId = await this.getAccountId();
        const repositoryName = this.naming.getEcrRepositoryName();
        let repositoryUri;
        try {
          const result = await this.request('ECR', 'describeRepositories', {
            repositoryNames: [repositoryName],
            registryId,
          });
          repositoryUri = result.repositories[0].repositoryUri;
        } catch (err) {
          if (!(err.providerError && err.providerError.code === 'RepositoryNotFoundException')) {
            throw err;
          }
          const result = await this.request('ECR', 'createRepository', {
            repositoryName,
            imageScanningConfiguration: { scanOnPush },
          });
          repositoryUri = result.repository.repositoryUri;
        }
        return {
          repositoryUri,
          repositoryName,
        };
      },
      { promise: true }
    ),
    resolveImageUriAndShaFromPath: d(
      async function ({
        imageName,
        imagePath,
        imageFilename,
        buildArgs,
        cacheFrom,
        platform,
        scanOnPush,
      }) {
        const imageProgress = progress.get(`containerImage:${imageName}`);
        await this.ensureDockerIsAvailable();

        let isDockerfileAvailable = false;
        const pathToDockerfile = path.resolve(this.serverless.serviceDir, imagePath, imageFilename);

        try {
          const stats = await fsp.stat(pathToDockerfile);
          isDockerfileAvailable = stats.isFile();
        } catch {
          // pass and handle after catch block
        }
        if (!isDockerfileAvailable) {
          throw new ServerlessError(
            `Could not access Dockerfile under path: "${pathToDockerfile}"`,
            'DOCKERFILE_NOT_AVAILABLE_ERROR'
          );
        }

        const { repositoryUri, repositoryName } = await this.getOrCreateEcrRepository(scanOnPush);

        const localTag = `${repositoryName}:${imageName}`;
        const remoteTag = `${repositoryUri}:${imageName}`;

        const buildArgsArr = Object.keys(buildArgs)
          .map((key) => `${key}=${buildArgs[key]}`)
          .reduce((accumulator, current) => [...accumulator, '--build-arg', current], []);

        const cacheFromArr = cacheFrom.reduce(
          (accumulator, current) => [...accumulator, '--cache-from', current],
          []
        );

        const buildDockerArgs = [
          'build',
          '-t',
          localTag,
          '-f',
          pathToDockerfile,
          ...buildArgsArr,
          ...cacheFromArr,
          imagePath,
        ];

        // This is an optional argument, so we only append to the arguments if "platform" is specified.
        if (platform !== '') buildDockerArgs.push(`--platform=${platform}`);

        let imageSha;
        try {
          imageProgress.notice(`Building image "${imageName}"`);
          try {
            const { stdBuffer: buildDockerStdBuffer } = await spawnExt('docker', buildDockerArgs);
            if (buildDockerStdBuffer) {
              log.info(buildDockerStdBuffer.toString().trimRight());
            }
          } catch (err) {
            throw new ServerlessError(
              `Encountered error during executing: docker ${buildDockerArgs.join(
                ' '
              )}\nOutput of the command:\n${err.stdBuffer}`,
              'DOCKER_BUILD_ERROR'
            );
          }

          imageProgress.notice(`Tagging image "${imageName}"`);
          const tagDockerArgs = ['tag', localTag, remoteTag];
          try {
            const { stdBuffer: tagDockerStdBuffer } = await spawnExt('docker', tagDockerArgs);
            if (tagDockerStdBuffer) {
              log.info(tagDockerStdBuffer.toString().trimRight());
            }
          } catch (err) {
            throw new ServerlessError(
              `Encountered error during executing: docker ${tagDockerArgs.join(
                ' '
              )}\nOutput of the command:\n${err.stdBuffer}`,
              'DOCKER_TAG_ERROR'
            );
          }

          imageProgress.notice(`Uploading image "${imageName}"`);
          const dockerPushOutput = await this.dockerPushToEcr(remoteTag);
          // Extract imageSha from `docker push` output
          imageSha = dockerPushOutput.match(/(sha256:[a-f0-9]{64})/)[0];
        } finally {
          imageProgress.remove();
        }

        return {
          functionImageSha: imageSha.slice('sha256:'.length),
          functionImageUri: `${repositoryUri}@${imageSha}`,
        };
      },
      {
        promise: true,
        normalizer: (args) => {
          return JSON.stringify(deepSortObjectByKey(args[0]));
        },
      }
    ),
    resolveImageUriAndShaFromUri: d(
      async function (image) {
        const providedImageSha = image.split('@')[1];
        if (providedImageSha) {
          return {
            functionImageSha: providedImageSha.slice('sha256:'.length),
            functionImageUri: image,
          };
        }

        const [repositoryName, imageTag] = image.slice(image.indexOf('/') + 1).split(':');
        const parts = image.split('.');
        const registryId = parts[0];
        const region = parts[3];
        const serviceRegion = this.getRegion();
        if (region !== serviceRegion) {
          throw new ServerlessError(
            `The region "${region}" of the ECR image "${image}" must match provider region "${serviceRegion}".`,
            'LAMBDA_ECR_REGION_MISMATCH_ERROR'
          );
        }
        const describeImagesResponse = await this.request('ECR', 'describeImages', {
          imageIds: [
            {
              imageTag,
            },
          ],
          repositoryName,
          registryId,
        });
        const imageDigest = describeImagesResponse.imageDetails[0].imageDigest;
        const functionImageUri = `${image.split(':')[0]}@${imageDigest}`;
        return {
          functionImageUri,
          functionImageSha: imageDigest.slice('sha256:'.length),
        };
      },
      { promise: true }
    ),
    resolveImageUriAndSha: d(
      async function (functionName) {
        const { image } = this.serverless.service.getFunction(functionName);
        // Resolve if image on function was defined with uri or with name (reference to image in `provider.ecr.images`)
        const resolveImageUriOrName = () => {
          let uri;
          let name;

          if (_.isObject(image)) {
            if (!image.uri && !image.name) {
              throw new ServerlessError(
                `Either "uri" or "name" property needs to be set on image for function: ${functionName}`,
                'FUNCTION_IMAGE_NEITHER_URI_NOR_NAME_DEFINED_ERROR'
              );
            }
            if (image.uri && image.name) {
              throw new ServerlessError(
                `Either "uri" or "name" property (not both) needs to be set on image for function: ${functionName}`,
                'FUNCTION_IMAGE_BOTH_URI_AND_NAME_DEFINED_ERROR'
              );
            }
            if (image.uri) {
              uri = image.uri;
            } else {
              name = image.name;
            }
          } else if (isEcrUri(image)) {
            uri = image;
          } else {
            name = image;
          }

          return { imageUri: uri, imageName: name };
        };

        const { imageUri, imageName } = resolveImageUriOrName();
        const defaultDockerfile = 'Dockerfile';
        const defaultBuildArgs = {};
        const defaultCacheFrom = [];
        const defaultScanOnPush = false;
        const defaultPlatform = '';

        if (imageUri) {
          return await this.resolveImageUriAndShaFromUri(imageUri);
        }

        const imageDefinedInProvider = _.get(
          this.serverless.service.provider,
          `ecr.images.${imageName}`
        );

        const imageScanDefinedInProvider = _.get(
          this.serverless.service.provider,
          'ecr.scanOnPush',
          defaultScanOnPush
        );

        if (!imageDefinedInProvider) {
          throw new ServerlessError(
            `Referenced "${imageName}" not defined in "provider.ecr.images"`,
            'REFERENCED_FUNCTION_IMAGE_NOT_DEFINED_IN_PROVIDER'
          );
        }

        if (_.isObject(imageDefinedInProvider)) {
          if (!imageDefinedInProvider.uri && !imageDefinedInProvider.path) {
            throw new ServerlessError(
              `Either "uri" or "path" property needs to be set on image "${imageName}"`,
              'ECR_IMAGE_NEITHER_URI_NOR_PATH_DEFINED_ERROR'
            );
          }
          if (imageDefinedInProvider.uri && imageDefinedInProvider.path) {
            throw new ServerlessError(
              `Either "uri" or "path" property (not both) needs to be set on image "${imageName}"`,
              'ECR_IMAGE_BOTH_URI_AND_PATH_DEFINED_ERROR'
            );
          }
          if (imageDefinedInProvider.uri && imageDefinedInProvider.buildArgs) {
            throw new ServerlessError(
              `The "buildArgs" property cannot be used with "uri" property "${imageName}"`,
              'ECR_IMAGE_BOTH_URI_AND_BUILDARGS_DEFINED_ERROR'
            );
          }
          if (imageDefinedInProvider.uri && imageDefinedInProvider.cacheFrom) {
            throw new ServerlessError(
              `The "cacheFrom" property cannot be used with "uri" property "${imageName}"`,
              'ECR_IMAGE_BOTH_URI_AND_CACHEFROM_DEFINED_ERROR'
            );
          }
          if (imageDefinedInProvider.uri && imageDefinedInProvider.platform) {
            throw new ServerlessError(
              `The "platform" property cannot be used with "uri" property "${imageName}"`,
              'ECR_IMAGE_BOTH_URI_AND_PLATFORM_DEFINED_ERROR'
            );
          }
          if (imageDefinedInProvider.path) {
            return await this.resolveImageUriAndShaFromPath({
              imageName,
              imagePath: imageDefinedInProvider.path,
              imageFilename: imageDefinedInProvider.file || defaultDockerfile,
              buildArgs: imageDefinedInProvider.buildArgs || defaultBuildArgs,
              cacheFrom: imageDefinedInProvider.cacheFrom || defaultCacheFrom,
              platform: imageDefinedInProvider.platform || defaultPlatform,
              scanOnPush: imageScanDefinedInProvider,
            });
          }
          return await this.resolveImageUriAndShaFromUri(imageDefinedInProvider.uri);
        }
        if (isEcrUri(imageDefinedInProvider)) {
          return await this.resolveImageUriAndShaFromUri(imageDefinedInProvider);
        }
        return await this.resolveImageUriAndShaFromPath({
          imageName,
          imagePath: imageDefinedInProvider,
          imageFilename: defaultDockerfile,
          buildArgs: imageDefinedInProvider.buildArgs || defaultBuildArgs,
          cacheFrom: imageDefinedInProvider.cacheFrom || defaultCacheFrom,
          platform: imageDefinedInProvider.platform || defaultPlatform,
          scanOnPush: imageScanDefinedInProvider,
        });
      },
      { promise: true }
    ),
  })
);

module.exports = AwsProvider;
