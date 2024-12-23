'use strict';

const _ = require('lodash');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const wait = require('timers-ext/promise/sleep');
const validate = require('./lib/validate');
const filesize = require('../../utils/filesize');
const ServerlessError = require('../../serverless-error');
const { log, style, progress } = require('@serverless/utils/log');

const mainProgress = progress.get('main');

class AwsDeployFunction {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.packagePath =
      this.options.package ||
      this.serverless.service.package.path ||
      path.join(this.serverless.serviceDir || '.', '.serverless');
    this.provider = this.serverless.getProvider('aws');

    this.shouldEnsureFunctionState = false;

    Object.assign(this, validate);

    this.hooks = {
      'initialize': () => {
        const commandName = this.serverless.processedInput.commands.join(' ');
        if (commandName !== 'deploy function') return;
        log.notice();
        log.notice(
          `Deploying function ${this.options.function} to stage ${this.serverless
            .getProvider('aws')
            .getStage()} ${style.aside(`(${this.serverless.getProvider('aws').getRegion()})`)}`
        );
        log.info();
      },
      'before:deploy:function:initialize': () =>
        mainProgress.notice('Validating', { isMainEvent: true }),
      'deploy:function:initialize': async () => {
        await this.validate();
        await this.checkIfFunctionExists();
        this.checkIfFunctionChangesBetweenImageAndHandler();
      },

      'before:deploy:function:packageFunction': () =>
        mainProgress.notice('Retrieving function info', { isMainEvent: true }),
      'deploy:function:packageFunction': async () =>
        this.serverless.pluginManager.spawn('package:function'),

      'before:deploy:function:deploy': () =>
        mainProgress.notice('Packaging', { isMainEvent: true }),
      'deploy:function:deploy': async () => {
        if (!this.options['update-config']) {
          await this.deployFunction();
        }
        await this.updateFunctionConfiguration();
        if (this.shouldEnsureFunctionState) {
          await this.ensureFunctionState();
        }
        await this.serverless.pluginManager.spawn('aws:common:cleanupTempDir');
      },
    };
  }

  async checkIfFunctionExists() {
    // check if the function exists in the service
    this.options.functionObj = this.serverless.service.getFunction(this.options.function);

    // check if function exists on AWS
    const params = {
      FunctionName: this.options.functionObj.name,
    };

    const result = await (async () => {
      try {
        return await this.provider.request('Lambda', 'getFunction', params);
      } catch (error) {
        if (_.get(error, 'providerError.code') === 'ResourceNotFoundException') {
          const errorMessage = [
            `The function "${this.options.function}" you want to update is not yet deployed.`,
            ' Please run "serverless deploy" to deploy your service.',
            ' After that you can redeploy your services functions with the',
            ' "serverless deploy function" command.',
          ].join('');
          throw new ServerlessError(errorMessage, 'FUNCTION_NOT_YET_DEPLOYED');
        }
        throw error;
      }
    })();

    if (result) this.serverless.service.provider.remoteFunctionData = result;
  }

  checkIfFunctionChangesBetweenImageAndHandler() {
    const functionObject = this.serverless.service.getFunction(this.options.function);
    const remoteFunctionPackageType =
      this.serverless.service.provider.remoteFunctionData.Configuration.PackageType;

    if (functionObject.handler && remoteFunctionPackageType === 'Image') {
      throw new ServerlessError(
        `The function "${this.options.function}" you want to update with handler was previously packaged as an image. Please run "serverless deploy" to ensure consistent deploy.`,
        'DEPLOY_FUNCTION_CHANGE_BETWEEN_HANDLER_AND_IMAGE_ERROR'
      );
    }

    if (functionObject.image && remoteFunctionPackageType === 'Zip') {
      throw new ServerlessError(
        `The function "${this.options.function}" you want to update with image was previously packaged as zip file. Please run "serverless deploy" to ensure consistent deploy.`,
        'DEPLOY_FUNCTION_CHANGE_BETWEEN_HANDLER_AND_IMAGE_ERROR'
      );
    }
  }

  async normalizeArnRole(role) {
    if (typeof role === 'string') {
      if (role.indexOf(':') !== -1) {
        return role;
      }

      const roleResource = this.serverless.service.resources.Resources[role];

      if (roleResource.Type !== 'AWS::IAM::Role') {
        throw new ServerlessError(
          'Provided resource is not IAM Role',
          'ROLE_REFERENCES_NON_AWS_IAM_ROLE'
        );
      }
      const roleProperties = roleResource.Properties;
      if (!roleProperties.RoleName) {
        throw new ServerlessError(
          'Role resource missing RoleName property',
          'MISSING_ROLENAME_FOR_ROLE'
        );
      }
      const compiledFullRoleName = `${roleProperties.Path || '/'}${roleProperties.RoleName}`;

      const result = await this.provider.getAccountInfo();
      return `arn:${result.partition}:iam::${result.accountId}:role${compiledFullRoleName}`;
    }

    const data = await this.provider.request('IAM', 'getRole', {
      RoleName: role['Fn::GetAtt'][0],
    });
    return data.Arn;
  }

  async ensureFunctionState() {
    this.options.functionObj = this.serverless.service.getFunction(this.options.function);
    const params = {
      FunctionName: this.options.functionObj.name,
    };
    const startTime = Date.now();

    const callWithRetry = async () => {
      const result = await this.provider.request('Lambda', 'getFunction', params);
      if (
        result &&
        result.Configuration.State === 'Active' &&
        result.Configuration.LastUpdateStatus === 'Successful'
      ) {
        return;
      }
      const didOneMinutePass = Date.now() - startTime > 60 * 1000;
      if (didOneMinutePass) {
        throw new ServerlessError(
          'Ensuring function state timed out. Please try to deploy your function once again.',
          'DEPLOY_FUNCTION_ENSURE_STATE_TIMED_OUT'
        );
      }
      log.info(`Retrying ensure function state for function: ${this.options.function}.`);
      await wait(500);
      await callWithRetry();
    };

    await callWithRetry();
  }

  async callUpdateFunctionConfiguration(params) {
    const startTime = Date.now();

    const callWithRetry = async () => {
      try {
        await this.provider.request('Lambda', 'updateFunctionConfiguration', params);
      } catch (err) {
        const didOneMinutePass = Date.now() - startTime > 60 * 1000;

        if (err.providerError && err.providerError.code === 'ResourceConflictException') {
          if (didOneMinutePass) {
            throw new ServerlessError(
              'Retry timed out. Please try to deploy your function once again.',
              'DEPLOY_FUNCTION_CONFIGURATION_UPDATE_TIMED_OUT'
            );
          }
          log.info(
            `Retrying configuration update for function: ${this.options.function}. Reason: ${err.message}`
          );
          await wait(1000);
          await callWithRetry();
        } else {
          throw err;
        }
      }
    };
    await callWithRetry();
  }

  async updateFunctionConfiguration() {
    const functionObj = this.options.functionObj;
    const providerObj = this.serverless.service.provider;
    const remoteFunctionConfiguration =
      this.serverless.service.provider.remoteFunctionData.Configuration;
    const params = {
      FunctionName: functionObj.name,
    };

    const kmsKeyArn = functionObj.kmsKeyArn || providerObj.kmsKeyArn;

    if (kmsKeyArn) {
      params.KMSKeyArn = kmsKeyArn;
    }

    if (params.KMSKeyArn && params.KMSKeyArn === remoteFunctionConfiguration.KMSKeyArn) {
      delete params.KMSKeyArn;
    }

    if (functionObj.snapStart) {
      params.SnapStart = {
        ApplyOn: 'PublishedVersions',
      };
    }

    if (
      functionObj.description &&
      functionObj.description !== remoteFunctionConfiguration.Description
    ) {
      params.Description = functionObj.description;
    }

    if (functionObj.handler && functionObj.handler !== remoteFunctionConfiguration.Handler) {
      params.Handler = functionObj.handler;
    }

    if (functionObj.memorySize) {
      params.MemorySize = functionObj.memorySize;
    } else if (providerObj.memorySize) {
      params.MemorySize = providerObj.memorySize;
    }

    if (params.MemorySize && params.MemorySize === remoteFunctionConfiguration.MemorySize) {
      delete params.MemorySize;
    }

    if (functionObj.timeout) {
      params.Timeout = functionObj.timeout;
    } else if (providerObj.timeout) {
      params.Timeout = providerObj.timeout;
    }

    if (params.Timeout && params.Timeout === remoteFunctionConfiguration.Timeout) {
      delete params.Timeout;
    }

    // Check if we have remotely managed layers and add them to the update call
    // if they exist in the remote function configuration.
    const isConsoleSdkLayerArn = RegExp.prototype.test.bind(
      /(?:177335420605|321667558080):layer:sls-/u
    );
    const serverlessConsoleLayerArns = (remoteFunctionConfiguration.Layers || [])
      .filter(({ Arn: arn }) => isConsoleSdkLayerArn(arn))
      .map(({ Arn }) => Arn);
    const hasServerlessConsoleLayers = serverlessConsoleLayerArns.length > 0;
    if (!functionObj.layers || !functionObj.layers.some(_.isObject)) {
      // We need to initialize to an empty array so if a layer is removed
      // we will send an empty Layers array in the update call to remove any layers.
      // If there are no layers in the remove config this property will be set to undefined anyway.
      params.Layers = functionObj.layers || providerObj.layers || [];

      if (!remoteFunctionConfiguration.Layers) {
        remoteFunctionConfiguration.Layers = [];
      }

      if (hasServerlessConsoleLayers) {
        for (const layer of serverlessConsoleLayerArns) {
          if (!params.Layers.includes(layer)) {
            params.Layers.push(layer);
          }
        }
      }

      // Do not attach layers to the update call if the layers did not change.
      if (
        params.Layers &&
        remoteFunctionConfiguration.Layers &&
        _.isEqual(
          new Set(params.Layers),
          new Set(remoteFunctionConfiguration.Layers.map((layer) => layer.Arn))
        )
      ) {
        delete params.Layers;
      }
    }

    if (
      functionObj.onError &&
      !_.isObject(functionObj.onError) &&
      _.get(remoteFunctionConfiguration, 'DeadLetterConfig.TargetArn', null) !== functionObj.onError
    ) {
      params.DeadLetterConfig = {
        TargetArn: functionObj.onError,
      };
    }

    // Add empty environment object if it does not exist
    // so when we do the comparison below it will be equal to an empty object
    params.Environment = {
      Variables: {},
    };
    if (!remoteFunctionConfiguration.Environment) {
      remoteFunctionConfiguration.Environment = {
        Variables: {},
      };
    }

    if (functionObj.environment || providerObj.environment) {
      params.Environment.Variables = Object.assign(
        {},
        providerObj.environment,
        functionObj.environment
      );
    }
    if (Object.values(params.Environment.Variables).some((value) => _.isObject(value))) {
      delete params.Environment;
    } else {
      Object.keys(params.Environment.Variables).forEach((key) => {
        // taken from the bash man pages
        if (!key.match(/^[A-Za-z_][a-zA-Z0-9_]*$/)) {
          const errorMessage = 'Invalid characters in environment variable';
          throw new ServerlessError(errorMessage, 'DEPLOY_FUNCTION_INVALID_ENV_VARIABLE');
        }

        if (params.Environment.Variables[key] != null) {
          params.Environment.Variables[key] = String(params.Environment.Variables[key]);
        }
      });
    }
    // If we detected remotely managed layers, we need to add the environment variables
    // that are managed by the Serverless Console to the update call so they do not get removed.
    if (params.Environment && hasServerlessConsoleLayers) {
      const consoleEnvironmentVariableNames = [
        'AWS_LAMBDA_EXEC_WRAPPER',
        'SLS_ORG_ID',
        'SLS_DEV_MODE_ORG_ID',
        'SLS_DEV_TOKEN',
        'SERVERLESS_PLATFORM_STAGE',
      ];
      const remoteVariables = remoteFunctionConfiguration.Environment.Variables;
      const localVariables = params.Environment.Variables;
      for (const variableName of consoleEnvironmentVariableNames) {
        if (remoteVariables[variableName] && !localVariables[variableName]) {
          localVariables[variableName] = remoteVariables[variableName];
        }
      }
    }

    if (
      params.Environment &&
      remoteFunctionConfiguration.Environment &&
      _.isEqual(params.Environment.Variables, remoteFunctionConfiguration.Environment.Variables)
    ) {
      delete params.Environment;
    }

    if (functionObj.vpc || providerObj.vpc) {
      const vpc = functionObj.vpc || providerObj.vpc;
      params.VpcConfig = {};

      if (vpc.ipv6AllowedForDualStack) {
        params.VpcConfig.Ipv6AllowedForDualStack = vpc.ipv6AllowedForDualStack;
      }

      if (Array.isArray(vpc.securityGroupIds) && !vpc.securityGroupIds.some(_.isObject)) {
        params.VpcConfig.SecurityGroupIds = vpc.securityGroupIds;
      }

      if (Array.isArray(vpc.subnetIds) && !vpc.subnetIds.some(_.isObject)) {
        params.VpcConfig.SubnetIds = vpc.subnetIds;
      }

      const didVpcChange = () => {
        const remoteConfigToCompare = { Ipv6AllowedForDualStack: false, SecurityGroupIds: [], SubnetIds: [] };
        if (remoteFunctionConfiguration.VpcConfig) {
          remoteConfigToCompare.Ipv6AllowedForDualStack = new Set(
            remoteFunctionConfiguration.VpcConfig.Ipv6AllowedForDualStack || false
          );
          remoteConfigToCompare.SecurityGroupIds = new Set(
            remoteFunctionConfiguration.VpcConfig.SecurityGroupIds || []
          );
          remoteConfigToCompare.SubnetIds = new Set(
            remoteFunctionConfiguration.VpcConfig.SubnetIds || []
          );
        }
        const localConfigToCompare = {
          Ipv6AllowedForDualStack: new Set(params.VpcConfig.Ipv6AllowedForDualStack || false),
          SecurityGroupIds: new Set(params.VpcConfig.SecurityGroupIds || []),
          SubnetIds: new Set(params.VpcConfig.SubnetIds || []),
        };
        return _.isEqual(remoteConfigToCompare, localConfigToCompare);
      };

      if (!Object.keys(params.VpcConfig).length || didVpcChange()) {
        delete params.VpcConfig;
      }
    }

    const executionRole = this.provider.getCustomExecutionRole(functionObj);
    if (executionRole) {
      params.Role = await this.normalizeArnRole(executionRole);
    }

    if (params.Role === remoteFunctionConfiguration.Role) {
      delete params.Role;
    }

    if (functionObj.image) {
      const imageConfig = {};
      if (_.isObject(functionObj.image)) {
        if (functionObj.image.command) {
          imageConfig.Command = functionObj.image.command;
        }
        if (functionObj.image.entryPoint) {
          imageConfig.EntryPoint = functionObj.image.entryPoint;
        }
        if (functionObj.image.workingDirectory) {
          imageConfig.WorkingDirectory = functionObj.image.workingDirectory;
        }
      }

      if (
        !_.isEqual(
          imageConfig,
          _.get(remoteFunctionConfiguration, 'ImageConfigResponse.ImageConfig', {})
        )
      ) {
        params.ImageConfig = imageConfig;
      }
    }

    if (!Object.keys(_.omit(params, 'FunctionName')).length) {
      if (this.options['update-config']) log.notice();
      const noticeMessage = [
        'Function configuration did not change, and the update was skipped.',
        ' If you made changes to the service configuration and expected them to be deployed,',
        ' it most likely means that they can only be applied with a full service deployment.',
      ].join('');
      log.notice.skip(
        `${noticeMessage} ${style.aside(
          `(${Math.floor(
            (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
          )}s)`
        )}`
      );
      return;
    }

    mainProgress.notice('Updating function configuration', { isMainEvent: true });

    await this.callUpdateFunctionConfiguration(params);
    this.shouldEnsureFunctionState = true;
    if (this.options['update-config']) log.notice();
    log.notice.success(
      `Function configuration updated ${style.aside(
        `(${Math.floor((Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000)}s)`
      )}\n`
    );
  }

  async deployFunction() {
    const functionObject = this.serverless.service.getFunction(this.options.function);
    const params = {
      FunctionName: this.options.functionObj.name,
    };

    if (functionObject.image) {
      const { functionImageUri, functionImageSha } = await this.provider.resolveImageUriAndSha(
        this.options.function
      );
      const remoteImageSha =
        this.serverless.service.provider.remoteFunctionData.Configuration.CodeSha256;
      if (remoteImageSha === functionImageSha && !this.options.force) {
        log.notice();
        log.notice.skip(
          `Image did not change. Function deployment skipped. ${style.aside(
            `(${Math.floor(
              (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
            )}s)`
          )}`
        );
        return;
      }
      params.ImageUri = functionImageUri;
    } else {
      const artifactFileName = this.provider.naming.getFunctionArtifactName(this.options.function);
      let artifactFilePath =
        this.serverless.service.package.artifact || path.join(this.packagePath, artifactFileName);
      // check if an artifact is used in function package level
      if (_.get(functionObject, 'package.artifact')) {
        artifactFilePath = functionObject.package.artifact;
      }

      const data = fs.readFileSync(artifactFilePath);

      const remoteHash =
        this.serverless.service.provider.remoteFunctionData.Configuration.CodeSha256;
      const localHash = crypto.createHash('sha256').update(data).digest('base64');

      if (remoteHash === localHash && !this.options.force) {
        log.notice();
        log.notice.skip(
          `Code did not change. Function deployment skipped. ${style.aside(
            `(${Math.floor(
              (Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000
            )}s)`
          )}`
        );
        return;
      }

      params.ZipFile = data;

      const stats = fs.statSync(artifactFilePath);
      mainProgress.notice(`Uploading ${style.aside(`(${filesize(stats.size)})`)}`, {
        isMainEvent: true,
      });
    }

    mainProgress.notice('Deploying', { isMainEvent: true });
    await this.provider.request('Lambda', 'updateFunctionCode', params);
    this.shouldEnsureFunctionState = true;
    log.notice();
    log.notice.success(
      `Function code deployed ${style.aside(
        `(${Math.floor((Date.now() - this.serverless.pluginManager.commandRunStartTime) / 1000)}s)`
      )}`
    );
  }
}

module.exports = AwsDeployFunction;
