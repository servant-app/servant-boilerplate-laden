import path from 'path'
import _ from 'lodash'
import utils from '@serverlessinc/sf-core/src/utils.js'
import ServerlessError from '../serverless-error.js'
import renderCommandHelp from '../cli/render-help/command.js'
import tokenizeException from '../utils/tokenize-exception.js'
import { fileURLToPath, pathToFileURL } from 'url'
// Load Plugins
import pluginPackage from '../plugins/package/package.js'
import pluginDeploy from '../plugins/deploy.js'
import pluginInvoke from '../plugins/invoke.js'
import pluginInfo from '../plugins/info.js'
import pluginDev from '../plugins/dev.js'
import pluginLogs from '../plugins/logs.js'
import pluginMetrics from '../plugins/metrics.js'
import pluginPrint from '../plugins/print.js'
import pluginRemove from '../plugins/remove.js'
import pluginRollback from '../plugins/rollback.js'
import pluginPlugin from '../plugins/plugin/plugin.js'
import pluginList from '../plugins/plugin/list.js'
import pluginSearch from '../plugins/plugin/search.js'
import pluginAwsProvider from '../plugins/aws/provider.js'
import pluginAwsCommon from '../plugins/aws/common/index.js'
import pluginAwsPackage from '../plugins/aws/package/index.js'
import pluginAwsDeploy from '../plugins/aws/deploy/index.js'
import pluginAwsInvoke from '../plugins/aws/invoke.js'
import pluginAwsDev from '../plugins/aws/dev/index.js'
import pluginAwsInfo from '../plugins/aws/info/index.js'
import pluginAwsLogs from '../plugins/aws/logs.js'
import pluginAwsMetrics from '../plugins/aws/metrics.js'
import pluginAwsRemove from '../plugins/aws/remove/index.js'
import pluginAwsRollback from '../plugins/aws/rollback.js'
import pluginAwsRollbackFunction from '../plugins/aws/rollback-function.js'
import pluginAwsPackageCompileLayers from '../plugins/aws/package/compile/layers.js'
import pluginAwsPackageCompileFunctions from '../plugins/aws/package/compile/functions.js'
import pluginAwsPackageCompileEventsSchedule from '../plugins/aws/package/compile/events/schedule.js'
import pluginAwsPackageCompileEventsS3 from '../plugins/aws/package/compile/events/s3/index.js'
import pluginAwsPackageCompileEventsApiGateway from '../plugins/aws/package/compile/events/api-gateway/index.js'
import pluginAwsPackageCompileEventsWebsockets from '../plugins/aws/package/compile/events/websockets/index.js'
import pluginAwsPackageCompileEventsSns from '../plugins/aws/package/compile/events/sns.js'
import pluginAwsPackageCompileEventsStream from '../plugins/aws/package/compile/events/stream.js'
import pluginAwsPackageCompileEventsKafka from '../plugins/aws/package/compile/events/kafka.js'
import pluginAwsPackageCompileEventsActivemq from '../plugins/aws/package/compile/events/activemq.js'
import pluginAwsPackageCompileEventsRabbitmq from '../plugins/aws/package/compile/events/rabbitmq.js'
import pluginAwsPackageCompileEventsMsk from '../plugins/aws/package/compile/events/msk/index.js'
import pluginAwsPackageCompileEventsAlb from '../plugins/aws/package/compile/events/alb/index.js'
import pluginAwsPackageCompileEventsAlexaSkill from '../plugins/aws/package/compile/events/alexa-skill.js'
import pluginAwsPackageCompileEventsAlexaSmartHome from '../plugins/aws/package/compile/events/alexa-smart-home.js'
import pluginAwsPackageCompileEventsIot from '../plugins/aws/package/compile/events/iot.js'
import pluginAwsPackageCompileEventsIotFleetProvisioning from '../plugins/aws/package/compile/events/iot-fleet-provisioning.js'
import pluginAwsPackageCompileEventsCloudWatchEvent from '../plugins/aws/package/compile/events/cloud-watch-event.js'
import pluginAwsPackageCompileEventsCloudWatchLog from '../plugins/aws/package/compile/events/cloud-watch-log.js'
import pluginAwsPackageCompileEventsCognitoUserPool from '../plugins/aws/package/compile/events/cognito-user-pool.js'
import pluginAwsPackageCompileEventsEventBridge from '../plugins/aws/package/compile/events/event-bridge/index.js'
import pluginAwsPackageCompileEventsSqs from '../plugins/aws/package/compile/events/sqs.js'
import pluginAwsPackageCompileEventsCloudFront from '../plugins/aws/package/compile/events/cloud-front.js'
import pluginAwsPackageCompileEventsHttpApi from '../plugins/aws/package/compile/events/http-api.js'
import pluginAwsDeployFunction from '../plugins/aws/deploy-function.js'
import pluginAwsDeployList from '../plugins/aws/deploy-list.js'
import pluginAwsInvokeLocal from '../plugins/aws/invoke-local/index.js'
import pluginEsbuild from '../plugins/esbuild/index.js'
import pluginAxiom from '../plugins/observability/axiom/index.js'
import { createRequire } from 'module'

const { log, getPluginWriters } = utils

const internalPlugins = [
  pluginPackage,
  pluginDeploy,
  pluginInvoke,
  pluginInfo,
  pluginDev,
  pluginLogs,
  pluginMetrics,
  pluginPrint,
  pluginRemove,
  pluginRollback,
  pluginPlugin,
  pluginList,
  pluginSearch,
  pluginAwsProvider,
  pluginAwsCommon,
  pluginAwsPackage,
  pluginAwsDeploy,
  pluginAwsInvoke,
  pluginAwsDev,
  pluginAwsInfo,
  pluginAwsLogs,
  pluginAwsMetrics,
  pluginAwsRemove,
  pluginAwsRollback,
  pluginAwsRollbackFunction,
  pluginAwsPackageCompileLayers,
  pluginAwsPackageCompileFunctions,
  pluginAwsPackageCompileEventsSchedule,
  pluginAwsPackageCompileEventsS3,
  pluginAwsPackageCompileEventsApiGateway,
  pluginAwsPackageCompileEventsWebsockets,
  pluginAwsPackageCompileEventsSns,
  pluginAwsPackageCompileEventsStream,
  pluginAwsPackageCompileEventsKafka,
  pluginAwsPackageCompileEventsActivemq,
  pluginAwsPackageCompileEventsRabbitmq,
  pluginAwsPackageCompileEventsMsk,
  pluginAwsPackageCompileEventsAlb,
  pluginAwsPackageCompileEventsAlexaSkill,
  pluginAwsPackageCompileEventsAlexaSmartHome,
  pluginAwsPackageCompileEventsIot,
  pluginAwsPackageCompileEventsIotFleetProvisioning,
  pluginAwsPackageCompileEventsCloudWatchEvent,
  pluginAwsPackageCompileEventsCloudWatchLog,
  pluginAwsPackageCompileEventsCognitoUserPool,
  pluginAwsPackageCompileEventsEventBridge,
  pluginAwsPackageCompileEventsSqs,
  pluginAwsPackageCompileEventsCloudFront,
  pluginAwsPackageCompileEventsHttpApi,
  pluginAwsDeployFunction,
  pluginAwsDeployList,
  pluginAwsInvokeLocal,
  pluginEsbuild,
  pluginAxiom,
]

let hooksIdCounter = 0
let nestTracker = 0

const typescriptPlugins = [
  'serverless-esbuild',
  'serverless-plugin-typescript',
  'serverless-webpack',
  'serverless-bundle',
]

const mergeCommands = (target, source) => {
  if (!target) return source
  for (const key of Object.keys(source)) {
    if (target[key] == null) {
      target[key] = source[key]
      continue
    }
    switch (key) {
      case 'options':
        for (const [name, value] of Object.entries(source.options)) {
          if (!target.options[name]) target.options[name] = value
        }
        break
      case 'commands':
        for (const [name, value] of Object.entries(source.commands)) {
          target.commands[name] = mergeCommands(target.commands[name], value)
        }
        break
      case 'lifecycleEvents':
        if (source[key].length) target[key] = source[key]
        break
      default:
    }
  }
  return target
}

/**
 * @private
 * Error type to terminate the currently running hook chain successfully without
 * executing the rest of the current command's lifecycle chain.
 */
class TerminateHookChain extends Error {
  constructor(commands) {
    const commandChain = commands.join(':')
    const message = `Terminating ${commandChain}`
    super(message)
    this.message = message
    this.name = 'TerminateHookChain'
  }
}

let isRegisteringExternalPlugins = false

class PluginManager {
  constructor(serverless) {
    this.serverless = serverless

    this.cliOptions = {}
    this.cliCommands = []

    this.plugins = []
    this.externalPlugins = new Set()
    this.commands = {}
    this.aliases = {}
    this.hooks = {}
    this.deprecatedEvents = {}
  }

  setCliOptions(options) {
    this.cliOptions = options
  }

  setCliCommands(commands) {
    this.cliCommands = commands
  }

  addPlugin(Plugin) {
    const pluginName = Plugin._serverlessExternalPluginName || Plugin.name

    if (
      typescriptPlugins.includes(pluginName) &&
      this.serverless.service.build?.esbuild !== false
    ) {
      const errorMessage = `Serverless now includes ESBuild and supports Typescript out-of-the-box. But this conflicts with the plugin '${pluginName}'.\nYou can either remove this plugin and try Serverless's ESBuild support builtin, or you can set 'build.esbuild' to false in your 'serverless.yml'.\nFor more information go to, https://www.serverless.com/framework/docs/providers/aws/guide/building`
      throw new ServerlessError(errorMessage, 'PLUGIN_TYPESCRIPT_CONFLICT')
    }
    const pluginUtils = {}
    Object.assign(
      pluginUtils,
      getPluginWriters(Plugin._serverlessExternalPluginName || Plugin.name),
    )
    const pluginInstance = new Plugin(
      this.serverless,
      this.cliOptions,
      pluginUtils,
    )
    if (isRegisteringExternalPlugins) {
      this.externalPlugins.add(pluginInstance)
    }

    let pluginProvider = null
    // check if plugin is provider agnostic
    if (pluginInstance.provider) {
      if (typeof pluginInstance.provider === 'string') {
        pluginProvider = pluginInstance.provider
      } else if (_.isObject(pluginInstance.provider)) {
        pluginProvider = pluginInstance.provider.constructor.getProviderName()
      }
    }

    // ignore plugins that specify a different provider than the current one
    if (
      pluginProvider &&
      pluginProvider !== this.serverless.service.provider.name
    ) {
      return null
    }

    // don't load plugins twice
    if (this.plugins.some((plugin) => plugin instanceof Plugin)) {
      throw new ServerlessError(
        'Encountered duplicate plugin definition. Please remove duplicate plugins from your configuration.',
        'DUPLICATE_PLUGIN_DEFINITION',
      )
    }

    this.loadCommands(pluginInstance)
    this.loadHooks(pluginInstance)

    this.plugins.push(pluginInstance)

    return pluginInstance
  }

  async loadAllPlugins(servicePlugins) {
    // Load Internal Plugins
    isRegisteringExternalPlugins = false
    internalPlugins.filter(Boolean).forEach((Plugin) => this.addPlugin(Plugin))

    // Load External Plugins
    isRegisteringExternalPlugins = true
    const resolvedServicePlugins =
      await this.resolveServicePlugins(servicePlugins)
    const reorderedServicePlugins = this.sortServicePlugins(
      resolvedServicePlugins,
    )
    reorderedServicePlugins
      .filter(Boolean)
      .forEach((Plugin) => this.addPlugin(Plugin))

    isRegisteringExternalPlugins = true
    return this.asyncPluginInit()
  }

  /**
   * Return a promise to require a Service plugin, whether it's local in a relative path,
   * local in the service directory, or a node_module
   * @param {*} serviceDir
   * @param {*} pluginListedName
   * @param {*} legacyLocalPluginsPath
   * @returns
   */
  async requireServicePlugin(
    serviceDir,
    pluginListedName,
    legacyLocalPluginsPath,
  ) {
    const logger = log.get('sls:plugins:load')

    const require = async (dir, module) => {
      try {
        const require = createRequire(path.resolve(dir, 'require-resolver'))
        return require.resolve(module)
      } catch (error) {
        logger.debug(
          `Failed to resolve path for module ${module} from ${dir} due to '${error}'`,
        )
        return null
      }
    }

    /**
     * Check the Service directory for the plugin.
     * This will check in the node_modules of the service directory
     * and in the service directory itself.
     */
    const localPluginPath = await require(serviceDir, pluginListedName)
    if (localPluginPath) {
      return await import(pathToFileURL(localPluginPath))
    }

    /**
     * Search in the Framework's node_modules
     */
    const externalPluginPath = await require(fileURLToPath(
      import.meta.url,
    ), pluginListedName)
    if (!externalPluginPath) {
      throw new ServerlessError(
        `Serverless plugin "${pluginListedName}" not found.`,
        'PLUGIN_NOT_FOUND',
      )
    }
    return await import(pathToFileURL(externalPluginPath))
  }

  async resolveServicePlugins(servicePlugs) {
    const pluginsObject = this.parsePluginsObject(servicePlugs)
    const serviceDir = this.serverless.serviceDir

    const pluginNames = pluginsObject.modules

    const plugins = []
    for (const name of pluginNames) {
      let Plugin
      try {
        Plugin = await this.requireServicePlugin(
          serviceDir,
          name,
          pluginsObject.localPath,
        )
        Plugin = Plugin.default || Plugin
      } catch (error) {
        if (error.code !== 'PLUGIN_NOT_FOUND') throw error

        throw new ServerlessError(
          [
            `Serverless plugin "${name}" not found.`,
            ' Make sure it\'s installed and listed in the "plugins" section',
            ' of your serverless config file.',
            ' Use the --debug flag to learn more.',
          ].join(''),
          'PLUGIN_NOT_FOUND',
        )
      }
      if (!Plugin) {
        throw new ServerlessError(
          `Serverless plugin "${name}", didn't export Plugin constructor.`,
          'MISSING_PLUGIN_NAME',
        )
      }
      Object.defineProperty(Plugin, '_serverlessExternalPluginName', {
        value: name,
        configurable: true,
        writable: true,
      })
      plugins.push(Plugin)
    }
    return plugins
  }

  /**
   * Sort service plugins by prioritzing plugins with the "build" tag
   *
   * @param {Array} ServicePlugins
   * @returns {Array} reordered plugins
   */
  sortServicePlugins(ServicePlugins) {
    // List of build plugins that are in the service
    const prioritized = ServicePlugins.filter((P) => P?.tags?.includes('build'))

    // List of the rest of the plugins that are in the service
    const rest = ServicePlugins.filter((P) => !P?.tags?.includes('build'))

    // Sort by prioritizing build plugins first, then the rest of the plugins
    return [...prioritized, ...rest]
  }

  parsePluginsObject(servicePlugs) {
    let localPath =
      this.serverless &&
      this.serverless.serviceDir &&
      path.join(this.serverless.serviceDir, '.serverless_plugins')
    let modules = []

    if (Array.isArray(servicePlugs)) {
      modules = servicePlugs
    } else if (servicePlugs) {
      localPath =
        servicePlugs.localPath && typeof servicePlugs.localPath === 'string'
          ? servicePlugs.localPath
          : localPath
      if (Array.isArray(servicePlugs.modules)) {
        modules = servicePlugs.modules
      }
    }

    return { modules, localPath }
  }

  createCommandAlias(alias, command) {
    // Deny self overrides
    if (command.startsWith(alias)) {
      throw new ServerlessError(
        `Command "${alias}" cannot be overriden by an alias`,
        'INVALID_COMMAND_ALIAS',
      )
    }

    const splitAlias = alias.split(':')
    const aliasTarget = splitAlias.reduce((__, aliasPath) => {
      const currentAlias = __
      if (!currentAlias[aliasPath]) {
        currentAlias[aliasPath] = {}
      }
      return currentAlias[aliasPath]
    }, this.aliases)
    // Check if the alias is already defined
    if (aliasTarget.command) {
      throw new ServerlessError(
        `Alias "${alias}" is already defined for command ${aliasTarget.command}`,
        'COMMAND_ALIAS_ALREADY_DEFINED',
      )
    }
    // Check if the alias would overwrite an exiting command
    if (
      splitAlias.reduce((__, aliasPath) => {
        if (!__ || !__.commands || !__.commands[aliasPath]) {
          return null
        }
        return __.commands[aliasPath]
      }, this)
    ) {
      throw new ServerlessError(
        `Command "${alias}" cannot be overriden by an alias`,
        'INVALID_COMMAND_ALIAS',
      )
    }
    aliasTarget.command = command
  }

  loadCommand(pluginName, details, key, isEntryPoint) {
    const commandIsEntryPoint = details.type === 'entrypoint' || isEntryPoint
    log.get('sls:lifecycle:command:register').debug(key)
    // Check if there is already an alias for the same path as the command
    const aliasCommand = this.getAliasCommandTarget(key.split(':'))
    if (aliasCommand) {
      throw new ServerlessError(
        `Command "${key}" cannot override an existing alias`,
        'INVALID_COMMAND_OVERRIDE_EXISTING_ALIAS',
      )
    }
    // Load the command
    const commands = _.mapValues(details.commands, (subDetails, subKey) =>
      this.loadCommand(
        pluginName,
        subDetails,
        `${key}:${subKey}`,
        commandIsEntryPoint,
      ),
    )
    // Handle command aliases
    ;(details.aliases || []).forEach((alias) => {
      log.get('sls:lifecycle:command:register').debug(`  -> @${alias}`)
      this.createCommandAlias(alias, key)
    })
    return Object.assign({}, details, { key, pluginName, commands })
  }

  loadCommands(pluginInstance) {
    const pluginName = pluginInstance.constructor.name
    if (pluginInstance.commands) {
      Object.entries(pluginInstance.commands).forEach(([key, details]) => {
        const command = this.loadCommand(pluginName, details, key)
        if (!command.lifecycleEvents) command.lifecycleEvents = []
        this.commands[key] = mergeCommands(
          this.commands[key],
          _.merge({}, command, {
            isExternal: isRegisteringExternalPlugins,
          }),
        )
      })
    }
  }

  loadHooks(pluginInstance) {
    const pluginName = pluginInstance.constructor.name
    if (pluginInstance.hooks) {
      Object.entries(pluginInstance.hooks).forEach(([event, hook]) => {
        let target = event
        const baseEvent = event.replace(/^(?:after:|before:)/, '')
        if (this.deprecatedEvents[baseEvent]) {
          const redirectedEvent = this.deprecatedEvents[baseEvent]
          log.info(
            `Plugin "${pluginName}" uses deprecated hook "${event}". Use "${redirectedEvent}" hook instead.`,
          )
          if (redirectedEvent) {
            target = event.replace(baseEvent, redirectedEvent)
          }
        }
        this.hooks[target] = this.hooks[target] || []
        this.hooks[target].push({
          pluginName,
          hook,
        })
      })
    }
  }

  /**
   * Retrieves all public commands and aliases from the plugin manager. This method
   * iterates through the commands and stops at entrypoints to include only public
   * commands throughout the hierarchy. It then iterates through the existing aliases
   * and adds them as commands. The result is an object that maps command names to
   * their respective command objects, with each command object omitting its own
   * 'commands' property to prevent circular references.
   *
   * @returns {Object} An object mapping command names to command objects.
   */
  getCommands() {
    const result = {}

    // Iterate through the commands and stop at entrypoints to include only public
    // command throughout the hierarchy.
    const stack = [{ commands: this.commands, target: result }]
    while (stack.length) {
      const currentCommands = stack.pop()
      const commands = currentCommands.commands
      const target = currentCommands.target
      if (commands) {
        Object.entries(commands).forEach(([name, command]) => {
          if (command.type !== 'entrypoint') {
            target[name] = _.omit(command, 'commands')
            if (
              Object.values(command.commands).some(
                (childCommand) => childCommand.type !== 'entrypoint',
              )
            ) {
              target[name].commands = {}
              stack.push({
                commands: command.commands,
                target: target[name].commands,
              })
            }
          }
        })
      }
    }
    // Iterate through the existing aliases and add them as commands
    _.remove(stack)
    stack.push({ aliases: this.aliases, target: result })
    while (stack.length) {
      const currentAlias = stack.pop()
      const aliases = currentAlias.aliases
      const target = currentAlias.target
      if (aliases) {
        Object.entries(aliases).forEach(([name, alias]) => {
          if (name === 'command') {
            return
          }
          if (alias.command) {
            const commandPath = alias.command.split(':').join('.commands.')
            target[name] = _.get(this.commands, commandPath)
          } else {
            target[name] = target[name] || {}
            target[name].commands = target[name].commands || {}
          }
          stack.push({ aliases: alias, target: target[name].commands })
        })
      }
    }
    return result
  }

  getAliasCommandTarget(aliasArray) {
    // Check if the command references an alias
    const aliasCommand = aliasArray.reduce((__, commandPath) => {
      if (!__ || !__[commandPath]) {
        return null
      }
      return __[commandPath]
    }, this.aliases)

    return _.get(aliasCommand, 'command')
  }

  /**
   * Retrieve the command specified by a command list. The method can be configured
   * to include entrypoint commands (which are invisible to the CLI and can only
   * be used by plugins).
   * @param commandsArray {Array<String>} Commands
   * @param allowEntryPoints {undefined|boolean} Allow entrypoint commands to be returned
   * @returns {Object} Command
   */
  getCommand(commandsArray, allowEntryPoints) {
    // Check if the command references an alias
    const aliasCommandTarget = this.getAliasCommandTarget(commandsArray)
    const commandOrAlias = aliasCommandTarget
      ? aliasCommandTarget.split(':')
      : commandsArray

    return commandOrAlias.reduce(
      (current, name, index) => {
        const commandExists = name in current.commands
        const isNotContainer =
          commandExists && current.commands[name].type !== 'container'
        const isNotEntrypoint =
          commandExists && current.commands[name].type !== 'entrypoint'
        const remainingIterationsLeft = index < commandOrAlias.length - 1

        if (
          commandExists &&
          (isNotContainer || remainingIterationsLeft) &&
          (isNotEntrypoint || allowEntryPoints)
        ) {
          return current.commands[name]
        }

        if (!isNotContainer && isNotEntrypoint) return current.commands[name]

        // Invalid command, can happen only when Framework is used programmatically,
        // as otherwise command is validated in main script
        const err = new ServerlessError(
          `Unrecognized command "${commandsArray.join(' ')}".`,
          'UNRECOGNIZED COMMAND',
        )
        err.stack = undefined
        throw err
      },
      { commands: this.commands },
    )
  }

  getPlugins() {
    return this.plugins
  }

  getLifecycleEventsData(command) {
    const lifecycleEventsData = []
    let hooksLength = 0
    for (const lifecycleEventSubName of command.lifecycleEvents || []) {
      const lifecycleEventName = `${command.key}:${lifecycleEventSubName}`
      const hooksData = {
        before: this.hooks[`before:${lifecycleEventName}`] || [],
        at: this.hooks[lifecycleEventName] || [],
        after: this.hooks[`after:${lifecycleEventName}`] || [],
      }
      hooksLength +=
        hooksData.before.length + hooksData.at.length + hooksData.after.length
      lifecycleEventsData.push({
        command,
        lifecycleEventSubName,
        lifecycleEventName,
        hooksData,
      })
    }
    return { lifecycleEventsData, hooksLength }
  }

  async runHooks(hookName, hooks) {
    const debugLog = log.get('sls:lifecycle:command:invoke:hook')
    const hookId = ++hooksIdCounter
    for (const { hook } of hooks) {
      debugLog.debug(`[%d] ${'  '.repeat(nestTracker++)}< %s`, hookId, hookName)
      try {
        await hook()
      } finally {
        debugLog.debug(
          `[%d] ${'  '.repeat(--nestTracker)}> %s`,
          hookId,
          hookName,
        )
      }
    }
  }

  async invoke(commandsArray, allowEntryPoints) {
    const command = this.getCommand(commandsArray, allowEntryPoints)
    if (command.type === 'container') {
      renderCommandHelp(commandsArray.join(' '))
      return
    }

    this.convertShortcutsIntoOptions(command)
    this.validateServerlessConfigDependency(command)
    this.assignDefaultOptions(command)

    const { lifecycleEventsData, hooksLength } =
      this.getLifecycleEventsData(command)

    log
      .get('sls:lifecycle:command:invoke')
      .debug(
        `Invoke ${commandsArray.join(':')}${
          !hooksLength ? ' (noop due to no registered hooks)' : ''
        }`,
      )

    try {
      for (const {
        lifecycleEventName,
        hooksData: { before, at, after },
      } of lifecycleEventsData) {
        await this.runHooks(`before:${lifecycleEventName}`, before)
        await this.runHooks(lifecycleEventName, at)
        await this.runHooks(`after:${lifecycleEventName}`, after)
      }
    } catch (error) {
      if (error instanceof TerminateHookChain) {
        log.debug(`Terminate ${commandsArray.join(':')}`)
        return
      }
      throw error
    }
  }

  /**
   * Invokes the given command and starts the command's lifecycle.
   * This method can be called by plugins directly to spawn a separate sub lifecycle.
   */
  async spawn(commandsArray, options) {
    let commands = commandsArray
    if (typeof commandsArray === 'string') {
      commands = commandsArray.split(':')
    }
    await this.invoke(commands, true)
    if (_.get(options, 'terminateLifecycleAfterExecution', false)) {
      throw new TerminateHookChain(commands)
    }
  }

  /**
   * Executes the provided commands array. This method initializes hooks, invokes
   * the commands, and handles any exceptions that occur during command execution.
   * If an exception occurs, it triggers the error hooks and rethrows the exception.
   * After successful execution or error handling, it triggers the finalize hooks.
   * If an exception occurs during finalize, it rethrows the exception.
   *
   * @async
   * @param {Array} commandsArray - The array of commands to execute.
   * @throws {Error} If there's an error in command execution or during the
   * execution of error or finalize hooks.
   */
  async run(commandsArray) {
    this.commandRunStartTime = Date.now()
    if (this.serverless.processedInput.commands[0] !== 'plugin') {
      // first initialize hooks
      for (const { hook } of this.hooks.initialize || []) await hook()
    }

    let deferredBackendNotificationRequest

    try {
      await this.invoke(commandsArray)
    } catch (commandException) {
      try {
        for (const { hook } of this.hooks.error || [])
          await hook(commandException)
      } catch (errorHookException) {
        const errorHookExceptionMeta = tokenizeException(errorHookException)
        log.warning(
          `The "error" hook crashed with:\n${
            errorHookExceptionMeta.stack || errorHookExceptionMeta.message
          }`,
        )
      } finally {
        await deferredBackendNotificationRequest
        throw commandException // eslint-disable-line no-unsafe-finally
      }
    }

    try {
      for (const { hook } of this.hooks.finalize || []) await hook()
    } catch (finalizeHookException) {
      await deferredBackendNotificationRequest
      throw finalizeHookException
    }
  }

  /**
   * Check if the command is valid. Internally this function will only find
   * CLI accessible commands (command.type !== 'entrypoint')
   */
  validateCommand(commandsArray) {
    this.getCommand(commandsArray)
  }

  /**
   * If the command has no use when operated in a working directory with no serverless
   * configuration file, throw an error
   */
  validateServerlessConfigDependency(command) {
    if (
      command.configDependent ||
      command.serviceDependencyMode === 'required'
    ) {
      if (!this.serverless.configurationInput) {
        const msg = [
          'This command can only be run in a Serverless service directory. ',
          "Make sure to reference a valid config file in the current working directory if you're using a custom config file",
        ].join('')
        throw new ServerlessError(
          msg,
          'INVALID_COMMAND_MISSING_SERVICE_DIRECTORY',
        )
      }
    }
  }

  convertShortcutsIntoOptions(command) {
    if (command.options) {
      Object.entries(command.options).forEach(([optionKey, optionObject]) => {
        if (
          optionObject.shortcut &&
          Object.keys(this.cliOptions).includes(optionObject.shortcut)
        ) {
          Object.keys(this.cliOptions).forEach((option) => {
            if (option === optionObject.shortcut) {
              this.cliOptions[optionKey] = this.cliOptions[option]
            }
          })
        }
      })
    }
  }

  assignDefaultOptions(command) {
    if (command.options) {
      Object.entries(command.options).forEach(([key, value]) => {
        if (
          value.default != null &&
          (!this.cliOptions[key] || this.cliOptions[key] === true)
        ) {
          this.cliOptions[key] = value.default
        }
      })
    }
  }

  async asyncPluginInit() {
    return Promise.all(
      this.plugins.map((plugin) => plugin.asyncInit && plugin.asyncInit()),
    )
  }
}

export default PluginManager
