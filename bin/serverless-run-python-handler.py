#!/bin/env python2

from __future__ import print_function

import argparse
import traceback
import contextlib
import imp
import json
import os
import sys

parser = argparse.ArgumentParser(
    prog='run_handler',
    description='Runs a Lambda entry point (handler) with an optional event',
)

parser.add_argument(
    '--event', dest='event',
    type=json.loads,
    help=("The event that will be deserialized and passed to the function. "
          "This has to be valid JSON, and will be deserialized into a "
          "Python dictionary before your handler is invoked")
)

parser.add_argument(
    '--handler-path', dest='handler_path',
    help=("File path to the handler, e.g. `lib/function.py`")
)

parser.add_argument(
    '--handler-function', dest='handler_function',
    default='lambda_handler',
    help=("File path to the handler")
)


class FakeContext(object):
    def __init__(self, name='Fake', version='LATEST'):
        self.name = name
        self.version = version

    @property
    def get_remaining_time_in_millis(self):
        return 10000

    @property
    def function_name(self):
        return self.name

    @property
    def function_version(self):
        return self.version

    @property
    def invoked_function_arn(self):
        return 'arn:aws:lambda:serverless:' + self.name

    @property
    def memory_limit_in_mb(self):
        return 1024

    @property
    def aws_request_id(self):
        return '1234567890'


@contextlib.contextmanager
def preserve_value(namespace, name):
    """A context manager to restore a binding to its prior value

    At the beginning of the block, `__enter__`, the value specified is
    saved, and is restored when `__exit__` is called on the contextmanager

    namespace (object): Some object with a binding
    name (string): The name of the binding to be preserved.
    """
    saved_value = getattr(namespace, name)
    yield
    setattr(namespace, name, saved_value)


def make_module_from_file(module_name, module_filepath):
    """Make a new module object from the source code in specified file.

    :param module_name: Desired name (must be valid import name)
    :param module_filepath: The filesystem path with the Python source
    :return: A loaded module

    The Python import mechanism is not used. No cached bytecode
    file is created, and no entry is placed in `sys.modules`.
    """
    py_source_open_mode = 'U'
    py_source_description = (".py", py_source_open_mode, imp.PY_SOURCE)

    with open(module_filepath, py_source_open_mode) as module_file:
        with preserve_value(sys, 'dont_write_bytecode'):
            sys.dont_write_bytecode = True
            module = imp.load_module(
                module_name,
                module_file,
                module_filepath,
                py_source_description
            )
    return module


def bail_out(code=99):
        print(u'--- BEGIN TRACEBACK ---')
        traceback.print_exception(*sys.exc_info())
        print(u'--- END TRACEBACK ---')
        sys.exit(99)


def import_program_as_module(handler_file):
    """Import module from `handler_file` and return it to be used.

    Since we don't want to clutter up the filesystem, we're going to turn
    off bytecode generation (.pyc file creation)
    """
    module = make_module_from_file('lambda_handler', handler_file)
    sys.modules['lambda_handler'] = module

    return module


def run_with_context(handler, function_path, event=None):
    function = getattr(handler, function_path)
    return function(event or {}, FakeContext())


if __name__ == '__main__':
    args = parser.parse_args(sys.argv[1:])
    path = os.path.expanduser(args.handler_path)
    if not os.path.isfile(path):
        print(u'There is no such file "{}". --handler-path must be a '
              u'Python file'.format(path))
        sys.exit(99)

    try:
        handler = import_program_as_module(path)
    except Exception as e:
        print(u'Could not import your handler file, {}, please check '
              u'your code and try again.'.format(path))
        bail_out()

    try:
        result = run_with_context(handler, args.handler_function, args.event)
        print(json.dumps(result))
    except Exception as e:
        print(u'Failure running handler function {f} from file {file}'.format(
            f=args.handler_function,
            file=path
        ))
        bail_out(127)
