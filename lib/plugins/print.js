import os from 'os'; // Corrected import statement
import _ from 'lodash';
import jc from 'json-cycle';
import yaml from 'js-yaml';
import ServerlessError from '../serverless-error.js';
import cliCommandsSchema from '../cli/commands-schema.js';
import utils from '@serverlessinc/sf-core/src/utils.js'; // Verify these imports in your actual module

const { writeText, log } = utils; // Ensure that `writeText` and `log` are correctly defined in `utils.js`

class Print {
  constructor(serverless, options) {
    this.logger = log.get('sls:plugins:print');
    this.serverless = serverless;
    this.options = options || {};
    this.cache = {};

    this.commands = {
      print: {
        ...cliCommandsSchema.get('print'),
      },
    };
    this.hooks = {
      'print:print': this.print.bind(this),
    };
  }

  async print() {
    let conf = this.serverless.configurationInput;

    // Traverse the object using the specified path
    if (this.options.path) {
      const steps = this.options.path.split('.');
      for (const step of steps) {
        conf = conf[step];

        if (!conf) {
          throw new ServerlessError(
            `Path "${this.options.path}" not found`,
            'INVALID_PATH_ARGUMENT'
          );
        }
      }
    }

    // Apply an optional filter
    if (this.options.transform) {
      if (this.options.transform === 'keys') {
        conf = Object.keys(conf);
      } else {
        throw new ServerlessError(
          'Transform can only be "keys"',
          'INVALID_TRANSFORM'
        );
      }
    }

    // Print configuration in the specified format
    const format = this.options.format || 'yaml';
    let out;

    if (format === 'text') {
      if (Array.isArray(conf)) {
        out = conf.join(os.EOL);
      } else {
        if (_.isObject(conf)) {
          throw new ServerlessError(
            'Cannot print an object as "text"',
            'PRINT_INVALID_OBJECT_AS_TEXT'
          );
        }

        out = String(conf);
      }
    } else if (format === 'json') {
      out = jc.stringify(conf, null, '  ');
    } else if (format === 'yaml') {
      out = yaml.dump(JSON.parse(jc.stringify(conf)), { noRefs: true });
    } else {
      throw new ServerlessError(
        'Format must be "yaml", "json", or "text"',
        'PRINT_INVALID_FORMAT'
      );
    }

    this.logger.info(out); // Log the output using the logger
    this.logger.info(' '); // Ensure a new line is printed for readability
  }
}

export default Print;
