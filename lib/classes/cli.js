import utils from '@serverlessinc/sf-core/src/utils.js'

const { log } = utils
// Add fallback in case log.get fails or is undefined
const legacyPluginLog = log.get('sls:cli:plugin-legacy-log') || console

class CLI {
  constructor(serverless) {
    this.serverless = serverless
    // Initialize class properties for clarity and avoid undefined states
    this.loadedPlugins = []
    this.loadedCommands = {}
  }

  setLoadedPlugins(plugins) {
    this.loadedPlugins = plugins
  }

  setLoadedCommands(commands) {
    this.loadedCommands = commands
  }

  printDot() {
    // Check if process.stderr exists before writing to it
    if (process.stderr) {
      process.stderr.write('.')
    } else {
      // Fallback in case stderr isn't available
      legacyPluginLog.notice('.')
    }
  }

  log(message, entity, opts) {
    // Ensure entity logging is safe and consistent
    legacyPluginLog.notice(entity ? `${entity}: ${message}` : message)
  }

  consoleLog(message) {
    // As both log and consoleLog use the same method, they are left as separate for flexibility
    legacyPluginLog.notice(message)
  }
}

export default CLI
