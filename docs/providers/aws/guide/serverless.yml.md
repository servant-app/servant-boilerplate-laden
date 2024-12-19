<!--
title: Serverless Framework - AWS Lambda Guide - Serverless.yml Reference
menuText: Serverless.yml
menuOrder: 16
description: A list of all available properties on serverless.yml for AWS
layout: Doc
-->

<!-- DOCS-SITE-LINK:START automatically generated  -->

### [Read this on the main serverless docs site](https://www.serverless.com/framework/docs/providers/aws/guide/serverless.yml)

<!-- DOCS-SITE-LINK:END -->

# Serverless.yml Reference

Here is a list of all available properties in `serverless.yml` when the provider is set to `aws`.

## Root properties

```yml
# serverless.yml

# Service name
service: myservice

# Framework version constraint (semver constraint): '3', '^2.33'
frameworkVersion: '3'

# Configuration validation: 'error' (fatal error), 'warn' (logged to the output) or 'off' (default: warn)
# See https://www.serverless.com/framework/docs/configuration-validation
configValidationMode: error
# Load environment variables from .env files (default: false)
# See https://www.serverless.com/framework/docs/environment-variables
useDotenv: true
# 'warn' reports deprecations on the go, 'error' will result with an exception being thrown on first approached deprecation
deprecationNotificationMode: warn:summary
# Disable deprecations by their codes (default: empty)
# See https://www.serverless.com/framework/docs/deprecations
disabledDeprecations:
  - DEP_CODE_1 # Deprecation code to disable
  - '*' # Disable all deprecation messages
```

### Parameters

Learn more about stage parameters in the [Parameters documentation](../../../guides/parameters.md).

```yml
# serverless.yml

# Stage parameters
params:
  # Values for the "prod" stage
  prod:
    my-parameter: foo
  # Values for the "dev" stage
  dev:
    my-parameter: bar
```

## Provider

### General settings

```yml
# serverless.yml

provider:
  name: aws
  # Default stage (default: dev)
  stage: dev
  # Default region (default: us-east-1)
  region: us-east-1
  # The AWS profile to use to deploy (default: "default" profile)
  profile: production
  # Use a custom name for the CloudFormation stack
  stackName: custom-stack-name
  # Optional CloudFormation tags to apply to APIs and functions
  tags:
    foo: bar
    baz: qux
  # Optional CloudFormation tags to apply to the stack
  stackTags:
    key: value
  # Method used for CloudFormation deployments: 'changesets' or 'direct' (default: changesets)
  # See https://www.serverless.com/framework/docs/providers/aws/guide/deploying#deployment-method
  deploymentMethod: direct
  # List of existing Amazon SNS topics in the same region where notifications about stack events are sent.
  notificationArns:
    - 'arn:aws:sns:us-east-1:XXXXXX:mytopic'
  stackParameters:
    - ParameterKey: 'Keyname'
      ParameterValue: 'Value'
  # Disable automatic rollback by CloudFormation on failure. To be used for non-production environments.
  disableRollback: true
  rollbackConfiguration:
    MonitoringTimeInMinutes: 20
    RollbackTriggers:
      - Arn: arn:aws:cloudwatch:us-east-1:000000000000:alarm:health
        Type: AWS::CloudWatch::Alarm
      - Arn: arn:aws:cloudwatch:us-east-1:000000000000:alarm:latency
        Type: AWS::CloudWatch::Alarm
  tracing:
    # Can only be true if API Gateway is inside a stack.
    apiGateway: true
    # Optional, can be true (true equals 'Active'), 'Active' or 'PassThrough'
    lambda: true
```

### General function settings

Some function settings can be defined for all functions inside the `provider` key:

```yml
# serverless.yml

provider:
  runtime: nodejs14.x
  runtimeManagement: auto # optional, set how Lambda controls all functions runtime. AWS default is auto; this can either be 'auto' or 'onFunctionUpdate'. For 'manual', see example in hello function below (syntax for both is identical
  # Default memory size for functions (default: 1024MB)
  memorySize: 512
  # Default timeout for functions (default: 6 seconds)
  # Note: API Gateway has a maximum timeout of 30 seconds
  timeout: 10
  # Function environment variables
  environment:
    APP_ENV_VARIABLE: FOOBAR
  # Duration for CloudWatch log retention (default: forever).
  # Can be overridden for each function separately inside the functions block, see below on page.
  # Valid values: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-loggroup.html
  logRetentionInDays: 14
  # Policy defining how to monitor and mask sensitive data in CloudWatch logs
  # Policy format: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/mask-sensitive-log-data-start.html
  logDataProtectionPolicy:
    Name: data-protection-policy
  # KMS key ARN to use for encryption for all functions
  kmsKeyArn: arn:aws:kms:us-east-1:XXXXXX:key/some-hash
  # Version of hashing algorithm used by Serverless Framework for function packaging
  lambdaHashingVersion: 20201221
  # Use function versioning (enabled by default)
  versionFunctions: false
  # Processor architecture: 'x86_64' or 'arm64' via Graviton2 (default: x86_64)
  architecture: x86_64
```

### Deployment bucket

Serverless Framework needs a S3 bucket to store artifacts for deploying. That bucket is automatically created and managed by Serverless, but you can configure it explicitly if needed:

```yaml
provider:
  # The S3 prefix under which deployed artifacts are stored (default: serverless)
  deploymentPrefix: serverless
  # Configure the S3 bucket used by Serverless Framework to deploy code packages to Lambda
  deploymentBucket:
    # Name of an existing bucket to use (default: created by serverless)
    name: com.serverless.${self:provider.region}.deploys
    # On deployment, serverless prunes artifacts older than this limit (default: 5)
    maxPreviousDeploymentArtifacts: 10
    # Prevents public access via ACLs or bucket policies (default: false)
    # Note: the deployment bucket is not public by default. These are additional ACLs.
    blockPublicAccess: true
    # Skip the creation of a default bucket policy when the deployment bucket is created (default: false)
    skipPolicySetup: true
    # Enable bucket versioning (default: false)
    versioning: true
    # Server-side encryption method
    serverSideEncryption: AES256
    # For server-side encryption
    sseKMSKeyId: arn:aws:kms:us-east-1:xxxxxxxxxxxx:key/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
    # For server-side encryption with custom keys
    sseCustomerAlgorithim: AES256
    sseCustomerKey: string
    sseCustomerKeyMD5: md5sum
    # Tags that will be added to each of the deployment resources
    tags:
      key1: value1
      key2: value2
```

### API Gateway v2 HTTP API

The `httpApi` settings apply to [API Gateway v2 HTTP APIs](../events/http-api.md):

```yml
provider:
  httpApi:
    # Attach to an externally created HTTP API via its ID:
    id: xxxx
    # Set a custom name for the API Gateway API (default: ${sls:stage}-${self:service})
    name: dev-my-service
    # Payload format version (note: use quotes in YAML: '1.0' or '2.0') (default: '2.0')
    payload: '2.0'
    # Disable the default 'execute-api' HTTP endpoint (default: false)
    # Useful when using a custom domain.
    disableDefaultEndpoint: true
    # Enable detailed CloudWatch metrics (default: false)
    metrics: true
    # Enable CORS HTTP headers with default settings (allow all)
    # Can be fine-tuned with specific options
    cors: true
    authorizers:
      # JWT API authorizer
      someJwtAuthorizer:
        identitySource: $request.header.Authorization
        issuerUrl: https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx
        audience:
          - xxxx
          - xxxx
      # Custom Lambda request authorizer
      someCustomLambdaAuthorizer:
        # Should be set to 'request' for custom Lambda authorizers
        type: request
        # Mutually exclusive with `functionArn`
        functionName: authorizerFunc
        # Mutually exclusive with `functionName`
        functionArn: arn:aws:lambda:us-east-1:11111111111:function:external-authorizer
        # Optional. Custom name for created authorizer
        name: customAuthorizerName
        # Optional. Time to live for cached authorizer results, accepts values from 0 (no caching) to 3600 (1 hour)
        # When set to non-zero value, 'identitySource' must be defined as well
        resultTtlInSeconds: 300
        # Set if authorizer function will return authorization responses in simple format (default: false)
        enableSimpleResponses: true
        # Version of payload that will be sent to authorizer function (default: '2.0')
        payloadVersion: '2.0'
        # Optional. One or more mapping expressions of the request parameters in form of e.g `$request.header.Auth`.
        # Specified values are verified to be non-empty and not null by authorizer.
        # It is a required property when `resultTtlInSeconds` is non-zero as `identitySource` is additionally
        # used as cache key for authorizer responses caching.
        identitySource:
          - $request.header.Auth
          - $request.header.Authorization
        # Optional. Applicable only when using externally defined authorizer functions
        # to prevent creation of permission resource
        managedExternally: true
```

### API Gateway v1 REST API

The `apiGateway` settings apply to [API Gateway v1 REST APIs](../events/apigateway.md) and [websocket APIs](../events/websocket.md):

```yml
provider:
  # Use a custom name for the API Gateway API
  apiName: custom-api-name
  # Endpoint type for API Gateway REST API: edge or regional (default: edge)
  endpointType: REGIONAL
  # Use a custom name for the websockets API
  websocketsApiName: custom-websockets-api-name
  # custom route selection expression
  websocketsApiRouteSelectionExpression: $request.body.route
  # Use a custom description for the websockets API
  websocketsDescription: Custom Serverless Websockets
  # Optional API Gateway REST API global config
  apiGateway:
    # Attach to an externally created REST API via its ID:
    restApiId: xxxx
    # Root resource ID, represent as / path
    restApiRootResourceId: xxxx
    # List of existing resources that were created in the REST API. This is required or the stack will be conflicted
    restApiResources:
      '/users': xxxx
      '/users/create': xxxx
    # Attach to an externally created Websocket API via its ID:
    websocketApiId: xxxx
    # Disable the default 'execute-api' HTTP endpoint (default: false)
    disableDefaultEndpoint: true
    # Source of API key for usage plan: HEADER or AUTHORIZER
    apiKeySourceType: HEADER
    # List of API keys for the REST API
    apiKeys:
      - name: myFirstKey
        value: myFirstKeyValue
        description: myFirstKeyDescription
        customerId: myFirstKeyCustomerId
        # Can be used to disable the API key without removing it (default: true)
        enabled: false
      - ${sls:stage}-myFirstKey
      - ${env:MY_API_KEY} # you can hide it in a serverless variable
    # Compress response when larger than specified size in bytes (must be between 0 and 10485760)
    minimumCompressionSize: 1024
    # Description for the API Gateway stage deployment
    description: Some description
    # Optional binary media types the API might return
    binaryMediaTypes:
      - '*/*'
    # Optional detailed Cloud Watch Metrics
    metrics: false
    # Use `${service}-${stage}` naming for API Gateway. Will be `true` by default in v3.
    shouldStartNameWithService: false
    resourcePolicy:
      - Effect: Allow
        Principal: '*'
        Action: execute-api:Invoke
        Resource:
          - execute-api:/*/*/*
        Condition:
          IpAddress:
            aws:SourceIp:
              - '123.123.123.123'
    # Optional usage plan configuration
    usagePlan:
      quota:
        limit: 5000
        offset: 2
        period: MONTH
      throttle:
        burstLimit: 200
        rateLimit: 100
    request:
      # Request schema validation models that can be reused in `http` events
      # It is always defined for `application/json` content type
      schemas:
        global-model:
          # JSON Schema
          schema: ${file(schema.json)}
          # Optional: Name of the API Gateway model
          name: GlobalModel
          # Optional: Description of the API Gateway model
          description: 'A global model that can be referenced in functions'
```

### ALB

Configure [Application Load Balancer](../events/alb.md):

```yml
provider:
  alb:
    # Optional prefix to prepend when generating names for target groups
    targetGroupPrefix: xxxx
    authorizers:
      myFirstAuth:
        type: 'cognito'
        # Required
        userPoolArn: 'arn:aws:cognito-idp:us-east-1:123412341234:userpool/us-east-1_123412341'
        # Required
        userPoolClientId: '1h57kf5cpq17m0eml12EXAMPLE'
        # Required
        userPoolDomain: your-test-domain
        # If set to 'allow' this allows the request to be forwarded to the target when user is not authenticated.
        # When omitted it defaults 'deny' which makes a HTTP 401 Unauthorized error be returned.
        # Alternatively configure to 'authenticate' to redirect request to IdP authorization endpoint.
        onUnauthenticatedRequest: deny
        # optional. The query parameters (up to 10) to include in the redirect request to the authorization endpoint
        requestExtraParams:
          prompt: login
          redirect: false
        # Combination of any system-reserved scopes or custom scopes associated with the client (default: openid)
        scope: 'first_name age'
        # Name of the cookie used to maintain session information (default: AWSELBAuthSessionCookie)
        sessionCookieName: '🍪'
        # Maximum duration of the authentication session in seconds (default: 604800 seconds/7 days)
        sessionTimeout: 7000
      mySecondAuth:
        type: oidc
        # Required. The authorization endpoint of the IdP.
        # Must be a full URL, including the HTTPS protocol, the domain, and the path
        authorizationEndpoint: 'https://example.com'
        # Required
        clientId: i-am-client
        # If creating a rule this is required
        # If modifying a rule, this can be omitted if you set useExistingClientSecret to true (as below)
        clientSecret: i-am-secret
        # Only required if clientSecret is omitted
        useExistingClientSecret: true
        # Required. The OIDC issuer identifier of the IdP
        # This must be a full URL, including the HTTPS protocol, the domain, and the path
        issuer: 'https://www.iamscam.com'
        # Required
        tokenEndpoint: 'http://somewhere.org'
        # Required
        userInfoEndpoint: 'https://another-example.com'
        # If set to 'allow' this allows the request to be forwarded to the target when user is not authenticated.
        # Omit or set to 'deny' (default) to make a HTTP 401 Unauthorized error be returned instead.
        # Alternatively configure to 'authenticate' to redirect request to IdP authorization endpoint.
        onUnauthenticatedRequest: 'deny'
        requestExtraParams:
          prompt: login
          redirect: false
        scope: first_name age
        sessionCookieName: '🍪'
        sessionTimeout: 7000
```

### Docker image deployments in ECR

Configure [deployment via Docker images](./functions.md#referencing-container-image-as-a-target):

```yaml
provider:
  ecr:
    scanOnPush: true
    # Definitions of images that later can be referenced by key in `function.image`
    images:
      baseimage:
        # URI of an existing Docker image in ECR
        uri: 000000000000.dkr.ecr.us-east-1.amazonaws.com/test-image@sha256:6bb600b4d6e1d7cf521097177d111111ea373edb91984a505333be8ac9455d38
      anotherimage:
        # Path to the Docker context that will be used when building that image locally (default: '.')
        path: ./image/
        # Dockerfile that will be used when building the image locally (default: 'Dockerfile')
        file: Dockerfile.dev
        buildArgs:
          STAGE: ${sls:stage}
        cacheFrom:
          - my-image:latest
```

### CloudFront

Configure the CloudFront distribution used for [CloudFront Lambda@Edge events](../events/cloudfront.md):

```yml
provider:
  cloudFront:
    cachePolicies:
      # Used as a reference in function.events[].cloudfront.cachePolicy.name
      myCachePolicy1:
        DefaultTTL: 60
        MinTTL: 30
        MaxTTL: 3600
        Comment: my brand new cloudfront cache policy # optional
        ParametersInCacheKeyAndForwardedToOrigin:
          CookiesConfig:
            # Possible values are 'none', 'whitelist', 'allExcept' and 'all'
            CookieBehavior: whitelist
            Cookies:
              - my-public-cookie
          EnableAcceptEncodingBrotli: true # optional
          EnableAcceptEncodingGzip: true
          HeadersConfig:
            # Possible values are 'none' and 'whitelist'
            HeaderBehavior: whitelist
            Headers:
              - authorization
              - content-type
          QueryStringsConfig:
            # Possible values are 'none', 'whitelist', 'allExcept' and 'all'
            QueryStringBehavior: allExcept
            QueryStrings:
              - not-cached-query-string
```

### IAM permissions

Configure IAM roles and permissions applied to Lambda functions ([complete documentation](./iam.md)):

```yml
provider:
  iam:
    # Instruct Serverless to use an existing IAM role for all Lambda functions
    role: arn:aws:iam::XXXXXX:role/role
    # OR configure the role that will be created by Serverless (simplest):
    role:
      # Add statements to the IAM role to give permissions to Lambda functions
      statements:
        - Effect: Allow
          Action:
            - 's3:ListBucket'
          Resource:
            Fn::Join:
              - ''
              - - 'arn:aws:s3:::'
                - Ref: ServerlessDeploymentBucket
      # Optional custom name for default IAM role
      name: your-custom-name-role
      # Optional custom path for default IAM role
      path: /your-custom-path/
      # Optional IAM Managed Policies to include into the IAM Role
      managedPolicies:
        - arn:aws:iam:*****:policy/some-managed-policy
      # ARN of a Permissions Boundary for the role
      permissionsBoundary: arn:aws:iam::XXXXXX:policy/policy
      # CloudFormation tags
      tags:
        key: value
    # ARN of an IAM role for CloudFormation service. If specified, CloudFormation uses the role's credentials
    deploymentRole: arn:aws:iam::XXXXXX:role/role
  # Optional CF stack policy to restrict which resources can be updated/deleted on deployment
  # The example below allows updating all resources in the service except deleting/replacing EC2 instances (use with caution!)
  stackPolicy:
    - Effect: Allow
      Principal: '*'
      Action: 'Update:*'
      Resource: '*'
    - Effect: Deny
      Principal: '*'
      Resource: '*'
      Action:
        - Update:Replace
        - Update:Delete
      Condition:
        StringEquals:
          ResourceType:
            - AWS::EC2::Instance
```

### VPC

Configure the Lambda functions to run inside a VPC ([complete documentation](./functions.md#vpc-configuration)):

```yml
provider:
  # Optional VPC settings
  # If you use VPC then both securityGroupIds and subnetIds are required
  vpc:
    securityGroupIds:
      - securityGroupId1
      - securityGroupId2
    subnetIds:
      - subnetId1
      - subnetId2
```

### Logs

Configure logs for the deployed resources:

```yml
provider:
  logs:
    # Enable HTTP API logs
    # This can either be set to `httpApi: true` to use defaults, or configured via subproperties
    # Can only be configured if the API is created by Serverless Framework
    httpApi:
      format: '{ "requestId":"$context.requestId", "ip": "$context.identity.sourceIp", "requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod","routeKey":"$context.routeKey", "status":"$context.status","protocol":"$context.protocol", "responseLength":"$context.responseLength" }'

    # Enable REST API logs
    # This can either be set to `restApi: true` to use defaults, or configured via subproperties
    # Can only be configured if the API is created by Serverless Framework
    restApi:
      # Enables HTTP access logs (default: true)
      accessLogging: true
      # Log format to use for access logs
      format: 'requestId: $context.requestId'
      # Enable execution logging (default: true)
      executionLogging: true
      # Log level to use for execution logging: INFO or ERROR
      level: INFO
      # Log full requests/responses for execution logging (default: true)
      fullExecutionData: true
      # Existing IAM role to use for API Gateway when writing CloudWatch Logs (default: automatically created)
      role: arn:aws:iam::123456:role
      # Whether the API Gateway CloudWatch Logs role setting is not managed by Serverless (default: false)
      roleManagedExternally: false

    # Enable Websocket API logs
    # This can either be set to `websocket: true` to use defaults, or configured via subproperties.
    websocket:
      # Enables HTTP access logs (default: true)
      accessLogging: true
      # Log format to use for access logs
      format: 'requestId: $context.requestId'
      # Enable execution logging (default: true)
      executionLogging: true
      # Log level to use for execution logging: INFO or ERROR
      level: INFO
      # Log full requests/responses for execution logging (default: true)
      fullExecutionData: true

    # Optional, whether to write CloudWatch logs for custom resource lambdas as added by the framework
    frameworkLambda: true
```

### S3 buckets

Configure the S3 buckets created for [S3 Lambda events](../events/s3.md):

```yml
provider:
  # If you need to configure the bucket itself, you'll need to add s3 resources to the provider configuration
  s3:
    # Eventual additional properties in camel case
    bucketOne:
      # Supported properties are the same ones as supported by CF resource for S3 bucket
      # See https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket.html
      name: my-custom-bucket-name
      versioningConfiguration:
        Status: Enabled
```

## Package

The `serverless package` or `serverless deploy` commands [package the code of all functions into zip files](./packaging.md).
These zip files are then used for deployments.

```yml
# serverless.yml

# Optional deployment packaging configuration
package:
  # Directories and files to include in the deployed package
  patterns:
    - src/**
    - handler.js
    - '!.git/**'
    - '!.travis.yml'
  # Package each function as an individual artifact (default: false)
  individually: true
  # Explicitly set the package artifact to deploy (overrides native packaging behavior)
  artifact: path/to/my-artifact.zip
  # Automatically exclude NPM dev dependencies from the deployed package (default: true)
  excludeDevDependencies: false
```

## Functions

Configure the Lambda functions to deploy ([complete documentation](./functions.md)):

```yml
# serverless.yml

functions:
  # A function
  hello:
    # The file and module for this specific function. Cannot be used with 'image'.
    handler: users.create
    # Container image to use. Cannot be used with 'handler'.
    # Can be the URI of an image in ECR, or the name of an image defined in 'provider.ecr.images'
    image: baseimage
    runtime: nodejs14.x
    runtimeManagement:
      mode: manual # syntax required for manual, mode property also supports 'auto' or 'onFunctionUpdate' (see provider.runtimeManagement)
      arn: <aws runtime arn> # required when mode is manual
    # Memory size (default: 1024MB)
    memorySize: 512
    # Timeout (default: 6 seconds)
    # Note: API Gateway has a maximum timeout of 30 seconds
    timeout: 10
    # Function environment variables
    environment:
      APP_ENV_VARIABLE: FOOBAR
    # Configure the size of ephemeral storage available to your Lambda function (in MBs, default: 512)
    ephemeralStorageSize: 512
    # Override the Lambda function name
    name: ${sls:stage}-lambdaName
    description: My function
    # Processor architecture: 'x86_64' or 'arm64' via Graviton2 (default: x86_64)
    architecture: x86_64
    # Reserve a maximum number of concurrent instances (default: account limit)
    reservedConcurrency: 5
    # Provision a minimum number of concurrent instances (default: 0)
    provisionedConcurrency: 3
    # Override the IAM role to use for this function
    role: arn:aws:iam::XXXXXX:role/role
    # SNS topic or SQS ARN to use for the DeadLetterConfig (failed executions)
    onError: arn:aws:sns:us-east-1:XXXXXX:sns-topic
    # KMS key ARN to use for encryption for this function
    kmsKeyArn: arn:aws:kms:us-east-1:XXXXXX:key/some-hash
    # Defines if you want to make use of SnapStart, this feature can only be used in combination with a Java runtime. Configuring this property will result in either None or PublishedVersions for the Lambda function
    snapStart: true
    # Disable the creation of the CloudWatch log group
    disableLogs: false
    # Duration for CloudWatch log retention (default: forever). Overrides provider setting.
    logRetentionInDays: 14
    tags: # Function specific tags
      foo: bar
    # VPC settings for this function
    # If you use VPC then both subproperties (securityGroupIds and subnetIds) are required
    # Can be set to '~' to disable the use of a VPC
    vpc:
      securityGroupIds:
        - securityGroupId1
        - securityGroupId2
      subnetIds:
        - subnetId1
        - subnetId2
    # Lambda URL definition for this function, optional
    # Can be defined as `true` which will create URL without authorizer and cors settings
    url:
      authorizer: 'aws_iam' # Authorizer used for calls to Lambda URL
      cors:  # CORS configuration for Lambda URL, can also be defined as `true` with default CORS configuration
        allowedOrigins:
          - *
        allowedHeaders:
          - Authorization
        allowedMethods:
          - GET
        allowCredentials: true
        exposedResponseHeaders:
          - SomeHeader
        maxAge: 3600
    # Packaging rules specific to this function
    package:
      # Directories and files to include in the deployed package
      patterns:
        - src/**
        - handler.js
        - '!.git/**'
        - '!.travis.yml'
      # Explicitly set the package artifact to deploy (overrides native packaging behavior)
      artifact: path/to/my-artifact.zip
      # Package this function as an individual artifact (default: false)
      individually: true
    # ARN of Lambda layers to use
    layers:
      - arn:aws:lambda:region:XXXXXX:layer:LayerName:Y
    # Overrides the provider setting. Can be 'Active' or 'PassThrough'
    tracing: Active
    # Conditionally deploy the function
    condition: SomeCondition
    # CloudFormation 'DependsOn' option
    dependsOn:
      - MyThing
      - MyOtherThing
    # Lambda destination settings
    destinations:
      # Function name or ARN (or reference) of target (EventBridge/SQS/SNS topic)
      onSuccess: functionName
      # Function name or ARN (or reference) of target (EventBridge/SQS/SNS topic)
      onFailure: arn:xxx:target
      onFailure:
        type: sns
        arn:
          Ref: SomeTopicName
    # Mount an EFS filesystem
    fileSystemConfig:
      # ARN of EFS Access Point
      arn: arn:aws:elasticfilesystem:us-east-1:11111111:access-point/fsap-a1a1a1
      # Path under which EFS will be mounted and accessible in Lambda
      localMountPath: /mnt/example
    # Maximum retry attempts when an asynchronous invocation fails (between 0 and 2; default: 2)
    maximumRetryAttempts: 1
    # Maximum event age in seconds when invoking asynchronously (between 60 and 21600)
    maximumEventAge: 7200
    # Configuring Lambda advanced logging options
    loggingConfig:
      applicationLogLevel: DEBUG
      logFormat: JSON
      logGroup: helloLoggingLogGroup
      systemLogLevel: DEBUG
```

## Lambda events

Reference of [Lambda events](./events.md) that trigger functions:

### API Gateway v2 HTTP API

[API Gateway v2 HTTP API events](../events/http-api.md):

```yaml
functions:
  hello:
    # ...
    events:
      # HTTP API endpoint (API Gateway v2)
      - httpApi:
          method: GET
          path: /some-get-path/{param}
          authorizer: # Optional
            # Name of an authorizer defined in 'provider.httpApi.authorizers'
            name: someJwtAuthorizer
            scopes: # Optional
              - user.id
              - user.email
```

### API Gateway v1 REST API

[API Gateway v1 REST API events](../events/apigateway.md):

```yaml
functions:
  hello:
    # ...
    events:
      # REST API endpoint (API Gateway v1)
      - http:
          # Path for this endpoint
          path: users/create
          # HTTP method for this endpoint
          method: get
          # Enable CORS. Don't forget to return the right header in your response
          cors: true
          # Requires clients to add API keys values in the `x-api-key` header of their request
          private: true
          # An AWS API Gateway custom authorizer function
          authorizer:
            # Name of the authorizer function (must be in this service)
            name: authorizerFunc
            # Can be used instead of a name to reference a function outside of service
            arn: xxx:xxx:Lambda-Name
            resultTtlInSeconds: 0
            identitySource: method.request.header.Authorization
            identityValidationExpression: someRegex
            # Input of the authorizer function: auth token ('token') or the entire request event ('request') (default: token)
            type: token
          # Configure method request and integration request settings
          request:
            # HTTP endpoint URL and map path parameters for HTTP and HTTP_PROXY requests
            uri: http://url/{paramName}
            # Optional request parameter configuration
            parameters:
              paths:
                paramName: true # mark path parameter as required
              headers:
                headerName: true # mark header as required
                custom-header:
                  required: true
                  # Map the header to a static value or integration request variable
                  mappedValue: context.requestId
              querystrings:
                paramName: true # mark query string
            # Request schema validation mapped by content type
            schemas:
              # Define the valid JSON Schema for this content-type
              application/json: ${file(create_request.json)}
              application/json+abc:
                # Name of the API Gateway model
                name: ModelName
                description: 'Some description'
                schema: ${file(model_schema.json)}
            # Custom request mapping templates that overwrite default templates
            template:
              application/json: '{ "httpMethod" : "$context.httpMethod" }'
            # Optional define pass through behavior when content-type does not match any of the specified mapping templates
            passThrough: NEVER
```

### Websocket API

[API Gateway websocket events](../events/websocket.md):

```yaml
functions:
  hello:
    # ...
    events:
      - websocket:
          route: $connect
          # Optional, setting this enables callbacks on websocket requests for two-way communication
          routeResponseSelectionExpression: $default
          authorizer:
            # Use either "name" or arn" properties
            name: auth
            arn: arn:aws:lambda:us-east-1:1234567890:function:auth
            identitySource:
              - 'route.request.header.Auth'
              - 'route.request.querystring.Auth'
```

### S3

[S3 events](../events/s3.md):

```yaml
functions:
  hello:
    # ...
    events:
      - s3:
          bucket: photos
          event: s3:ObjectCreated:*
          rules:
            - prefix: uploads/
            - suffix: .jpg
          # Set to 'true' when using an existing bucket
          # Else the bucket will be automatically created
          existing: true
          # Optional, for forcing deployment of triggers on existing S3 buckets
          forceDeploy: true
```

### Schedule

[Schedule events](../events/schedule.md):

```yaml
functions:
  hello:
    # ...
    events:
      - schedule:
          name: my scheduled event
          description: a description of my scheduled event's purpose
          # Can also be an array of rate/cron expressions
          rate: rate(10 minutes)
          # (default: true)
          enabled: false
          # Note, you can use only one of input, inputPath, or inputTransformer
          input:
            key1: value1
            key2: value2
            stageParams:
              stage: dev
          inputPath: '$.stageVariables'
          inputTransformer:
            inputPathsMap:
              eventTime: '$.time'
            inputTemplate: '{"time": <eventTime>, "key1": "value1"}'
```

### SNS

[SNS events](../events/sns.md):

```yaml
functions:
  hello:
    # ...
    events:
      - sns:
          topicName: aggregate
          displayName: Data aggregation pipeline
          filterPolicy:
            pet:
              - dog
              - cat
          filterPolicyScope: MessageAttributes
          redrivePolicy:
            # (1) ARN
            deadLetterTargetArn: arn:aws:sqs:us-east-1:11111111111:myDLQ
            # (2) Ref (resource defined in same CF stack)
            deadLetterTargetRef: myDLQ
            # (3) Import (resource defined in outer CF stack)
            deadLetterTargetImport:
              arn: MyShared-DLQArn
              url: MyShared-DLQUrl
```

### SQS

[SQS events](../events/sqs.md):

```yaml
functions:
  hello:
    # ...
    events:
      - sqs:
          arn: arn:aws:sqs:region:XXXXXX:myQueue
          # Optional
          batchSize: 10
          # Optional, minimum is 0 and the maximum is 300 (seconds)
          maximumBatchingWindow: 10
          # (default: true)
          enabled: false
          functionResponseType: ReportBatchItemFailures
          filterPatterns:
            - a: [1, 2]
```

### Streams

[Stream events](../events/streams.md):

```yaml
functions:
  hello:
    # ...
    events:
      - stream:
          arn: arn:aws:kinesis:region:XXXXXX:stream/foo
          batchSize: 100
          maximumRecordAgeInSeconds: 120
          startingPosition: LATEST
          # (default: true)
          enabled: false
          functionResponseType: ReportBatchItemFailures
          filterPatterns:
            - partitionKey: [1]
```

### MSK

[MSK events](../events/msk.md):

```yaml
functions:
  hello:
    # ...
    events:
      - msk:
          # ARN of MSK Cluster
          arn: arn:aws:kafka:us-east-1:111111111:cluster/ClusterName/a1a1a1a1a
          # name of Kafka topic to consume from
          topic: kafkaTopic
          # Optional, must be in 1-10000 range
          batchSize: 100
          # Optional, must be in 0-300 range (seconds)
          maximumBatchingWindow: 30
          # Optional, can be set to LATEST, AT_TIMESTAMP or TRIM_HORIZON
          startingPosition: LATEST
          # Mandatory when startingPosition is AT_TIMESTAMP, must be in Unix time seconds
          startingPositionTimestamp: 10000123
          # (default: true)
          enabled: false
          # Optional, arn of the secret key for authenticating with the brokers in your MSK cluster.
          saslScram512: arn:aws:secretsmanager:region:XXXXXX:secret:AmazonMSK_xxxxxx
          # Optional, specifies the consumer group ID to be used when consuming from Kafka. If not provided, a random UUID will be generated
          consumerGroupId: MyConsumerGroupId
          # Optional, specifies event pattern content filtering
          filterPatterns:
            - value:
                a: [1, 2]
```

### ActiveMQ

[ActiveMQ events](../events/activemq.md):

```yaml
functions:
  hello:
    # ...
    events:
      - activemq:
          # ARN of ActiveMQ Broker
          arn: arn:aws:mq:us-east-1:0000:broker:ExampleMQBroker:b-xxx-xxx
          # Name of ActiveMQ queue consume from
          queue: queue-name
          # Secrets Manager ARN for basic auth credentials
          basicAuthArn: arn:aws:secretsmanager:us-east-1:01234567890:secret:MySecret
          # Optional, must be in 1-10000 range
          batchSize: 100
          # Optional, must be in 0-300 range (seconds)
          maximumBatchingWindow: 30
          # Optional, can be set to LATEST or TRIM_HORIZON
          startingPosition: LATEST
          # (default: true)
          enabled: false
          # Optional, specifies event pattern content filtering
          filterPatterns:
            - value:
                a: [1, 2]
```

### Kafka

[Kakfa events](../events/kafka.md):

```yaml
functions:
  hello:
    # ...
    events:
      - kafka:
          # See main kafka documentation for various access configuration settings
          accessConfigurations:
            # ...
          # An array of bootstrap server addresses
          bootstrapServers:
            - abc3.xyz.com:9092
            - abc2.xyz.com:9092
          # name of Kafka topic to consume from
          topic: MySelfManagedKafkaTopic
          # Optional, must be in 1-10000 range
          batchSize: 100
          # Optional, must be in 0-300 range (seconds)
          maximumBatchingWindow: 30
          # Optional, can be set to LATEST, AT_TIMESTAMP or TRIM_HORIZON
          startingPosition: LATEST
          # Mandatory when startingPosition is AT_TIMESTAMP
          startingPositionTimestamp: 10000123
          # (default: true)
          enabled: false
          # Optional, specifies the consumer group ID to be used when consuming from Kafka. If not provided, a random UUID will be generated
          consumerGroupId: MyConsumerGroupId
          # Optional, specifies event pattern content filtering
          filterPatterns:
            - eventName: INSERT
```

### RabbitMQ

[RabbitMQ events](../events/rabbitmq.md):

```yaml
functions:
  hello:
    # ...
    events:
      - rabbitmq:
          # ARN of RabbitMQ Broker
          arn: arn:aws:mq:us-east-1:0000:broker:ExampleMQBroker:b-xxx-xxx
          # Name of RabbitMQ queue consume from
          queue: queue-name
          # Name of RabbitMQ virtual host to consume from
          virtualHost: virtual-host
          # Secrets Manager ARN for basic auth credentials
          basicAuthArn: arn:aws:secretsmanager:us-east-1:01234567890:secret:MySecret
          # Optional, must be in 1-10000 range
          batchSize: 100
          # Optional, must be in 0-300 range (seconds)
          maximumBatchingWindow: 30
          # Optional, can be set to LATEST or TRIM_HORIZON
          startingPosition: LATEST
          # (default: true)
          enabled: false
          # Optional, specifies event pattern content filtering
          filterPatterns:
            - value:
                a: [1, 2]
```

### Alexa

[Alexa Skill events](../events/alexa-skill.md) and [Alexa Smart Home events](../events/alexa-smart-home.md):

```yaml
functions:
  hello:
    # ...
    events:
      - alexaSkill:
          appId: amzn1.ask.skill.xx-xx-xx-xx
          # (default: true)
          enabled: false
      - alexaSmartHome:
          appId: amzn1.ask.skill.xx-xx-xx-xx
          # (default: true)
          enabled: false
```

### IOT

[IoT events](../events/iot.md):

```yaml
functions:
  hello:
    # ...
    events:
      - iot:
          name: myIoTEvent
          description: An IoT event
          sql: "SELECT * FROM 'some_topic'"
          sqlVersion: beta
          # (default: true)
          enabled: false
```

### CloudWatch

[CloudWatch events](../events/cloudwatch-event.md) and [CloudWatch logs events](../events/cloudwatch-log.md):

```yaml
functions:
  hello:
    # ...
    events:
      - cloudwatchEvent:
          event:
            source:
              - 'aws.ec2'
            detail-type:
              - 'EC2 Instance State-change Notification'
            detail:
              state:
                - pending
          # Note, you can use only one of input, inputPath, or inputTransformer
          input:
            key1: value1
            key2: value2
            stageParams:
              stage: dev
          inputPath: '$.stageVariables'
          inputTransformer:
            inputPathsMap:
              eventTime: '$.time'
            inputTemplate: '{"time": <eventTime>, "key1": "value1"}'
      - cloudwatchLog:
          logGroup: '/aws/lambda/hello'
          filter: '{$.userIdentity.type = Root}'
```

### Cognito

[Cognito User Pool events](../events/cognito-user-pool.md):

```yaml
functions:
  hello:
    # ...
    events:
      - cognitoUserPool:
          pool: MyUserPool
          trigger: PreSignUp
          # Optional, if you're referencing an existing User Pool
          existing: true
          # Optional, for forcing deployment of triggers on existing User Pools
          forceDeploy: true
      - cognitoUserPool:
          pool: MyUserPool
          trigger: CustomEmailSender
          # Required, if you're using the CustomSMSSender or CustomEmailSender triggers
          # Can either be KMS Key ARN string or reference to KMS Key Resource ARN
          kmsKeyId: 'arn:aws:kms:eu-west-1:111111111111:key/12345678-9abc-def0-1234-56789abcdef1'
          existing: true
          forceDeploy: true
```

### ALB

[Application Load Balancer events](../events/alb.md):

```yaml
functions:
  hello:
    # ...
    events:
      - alb:
          listenerArn: arn:aws:elasticloadbalancing:us-east-1:12345:listener/app/my-load-balancer/50dcc0c9188/
          priority: 1
          targetGroupName: helloTargetGroup # optional
          conditions:
            host: example.com
            path: /hello
          # Optional, can also be set using a boolean value
          healthCheck:
            path: / # optional
            intervalSeconds: 35 # optional
            timeoutSeconds: 30 # optional
            healthyThresholdCount: 5 # optional
            unhealthyThresholdCount: 5 # optional
            matcher: # optional
              httpCode: '200'
```

### EventBridge

[EventBridge events](../events/event-bridge.md):

```yaml
functions:
  hello:
    # ...
    events:
      # Use the default AWS event bus
      - eventBridge:
          description: a description of my eventBridge event's purpose
          schedule: rate(10 minutes)
      # Create a custom event bus
      - eventBridge:
          eventBus: custom-saas-events
          pattern:
            source:
              - saas.external
      # Re-use an existing event bus
      - eventBridge:
          eventBus: arn:aws:events:us-east-1:12345:event-bus/custom-private-events
          pattern:
            source:
              - custom.private
          inputTransformer:
            inputPathsMap:
              eventTime: '$.time'
            inputTemplate: '{"time": <eventTime>, "key1": "value1"}'
      # Using 'inputs'
      - eventBridge:
          pattern:
            source:
              - 'aws.ec2'
            detail-type:
              - 'EC2 Instance State-change Notification'
            detail:
              state:
                - pending
          input:
            key1: value1
            key2: value2
            stageParams:
              stage: dev
      # Using 'inputPath'
      - eventBridge:
          pattern:
            source:
              - 'aws.ec2'
            detail-type:
              - 'EC2 Instance State-change Notification'
            detail:
              state:
                - pending
          inputPath: '$.stageVariables'
      # Using 'inputTransformer'
      - eventBridge:
          pattern:
            source:
              - 'aws.ec2'
            detail-type:
              - 'EC2 Instance State-change Notification'
            detail:
              state:
                - pending
          inputTransformer:
            inputPathsMap:
              eventTime: '$.time'
            inputTemplate: '{"time": <eventTime>, "key1": "value1"}'
          retryPolicy:
            maximumEventAge: 3600
            maximumRetryAttempts: 3
          deadLetterQueueArn: !GetAtt QueueName.Arn
```

### CloudFront

[CloudFront Lambda@Edge events](../events/cloudfront.md):

```yaml
functions:
  hello:
    # ...
    events:
      - cloudFront:
          eventType: viewer-response
          includeBody: true
          pathPattern: /docs*
          cachePolicy:
            # Use either name or id
            # Refers to a Cache Policy defined in 'provider.cloudFront.cachePolicies'
            name: myCachePolicy1
            # Refers to any external Cache Policy ID
            id: 658327ea-f89d-4fab-a63d-7e88639e58f6
          origin:
            DomainName: serverless.com
            OriginPath: /framework
            CustomOriginConfig:
              OriginProtocolPolicy: match-viewer
```

## Function layers

Deploy [Lambda function layers](./layers.md):

```yml
# serverless.yml

layers:
  # A Lambda layer
  hello:
    # required, path to layer contents on disk
    path: layer-dir
    # optional, Deployed Lambda layer name
    name: ${sls:stage}-layerName
    # optional, Description to publish to AWS
    description: Description of what the lambda layer does
    # optional, a list of runtimes this layer is compatible with
    compatibleRuntimes:
      - python3.11
    # optional, a list of architectures this layer is compatible with
    compatibleArchitectures:
      - x86_64
      - arm64
    # optional, a string specifying license information
    licenseInfo: GPLv3
    # optional, a list of AWS account IDs allowed to access this layer.
    allowedAccounts:
      - '*'
    # optional, false by default. If true, layer versions are not deleted as new ones are created
    retain: false
```

## AWS Resources

[Customize the CloudFormation template](./services.md#serverlessyml), for example to deploy extra CloudFormation resource:

```yml
# serverless.yml

# Insert raw CloudFormation (resources, outputs…) in the deployed template
resources:
  Resources:
    usersTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: usersTable
        AttributeDefinitions:
          - AttributeName: email
            AttributeType: S
        KeySchema:
          - AttributeName: email
            KeyType: HASH
        ProvisionedThroughput:
          ReadCapacityUnits: 1
          WriteCapacityUnits: 1

  extensions:
    # override Properties or other attributes of Framework-created resources.
    # See https://serverless.com/framework/docs/providers/aws/guide/resources#override-aws-cloudformation-resource for more details
    UsersCreateLogGroup:
      Properties:
        RetentionInDays: '30'

  # The "Outputs" that your AWS CloudFormation Stack should produce.  This allows references between services.
  Outputs:
    UsersTableArn:
      Description: The ARN for the User's Table
      Value: !GetAtt usersTable.Arn
      Export:
        # see Fn::ImportValue to use in other services
        # and http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html for documentation on use.
        Name: ${self:service}:${sls:stage}:UsersTableArn
```
