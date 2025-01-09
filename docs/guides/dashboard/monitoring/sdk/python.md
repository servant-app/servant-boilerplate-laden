<!--
title: Serverless Framework - SDK - Python
description: How to use the Serverless Framework Python SDK for monitoring and observability.
short_title: Serverless Observability - Python SDK
keywords:
  ['Serverless Framework', 'SDK', 'Python', 'Monitoring', 'Observability']
-->

<!-- DOCS-SITE-LINK:START automatically generated  -->

### [Read this on the main serverless docs site](https://www.serverless.com/framework/docs/guides/sdk/python/)

<!-- DOCS-SITE-LINK:END -->

# Python SDK

Serverless Framework Dashboard, when Instrumentation is enabled on an AWS Lambda function, will hook into the AWS Lambda runtime environment and automatically report
metrics, traces, spans, and events. To capture handled errors, warnings, and to
set custom tags, the SDK library must be added and instrumented in your AWS
Lambda function handler.

## Key terms

- An **Event** is an instance of an error, warning, or notice that is captured
  as a part of a Trace. Multiple events can be captured in a single trace.
- A **Captured Error** is an instance of an error that is sent to Serverless
  Framework Dashboard as an Event. It can be viewed in Dev Mode or the Trace Explorer Details.
- A **Captured Warning** is one instance of a string in Python that is sent to
  Serverless Framework Dashboard as an Event, much like a Captured Error.
- A **Tag** is a key/value-pair that can be set on the Trace or an individual
  Event, and sent to Serverless Framework Dashboard. Tags can be viewed on the Trace Explorer
  Details and Dev Mode.

## Compatibility

While Serverless Framework Dashboard is developed by the makers of the Serverless Framework, the entire Serverless Framework Dashboard product and this SDK are 100% agnostic of the deployment tool you use. Serverless Framework Dashboard and this SDK work just as well with Terraform, CDK, SAM, Pulumi, etc, as as they do with Serverless Framework.

## Installation

### Install the package

When Tracing is enabled in Serverless Framework Dashboard, an AWS Lambda Layer is added to your AWS Lambda function with the `sls_sdk` package. While the AWS
Lambda layer is added by Serverless Framework Dashboard, it is possible for the layer to be removed temporarily if you deploy manually or with some infrastructure as code tools. As such, we recommend bundling the SDK with your handler to avoid
unresolved references to the SDK.

```
pip install serverless-sdk
```

### Enable Instrumentation

The SDK will merely generate the necessary Tags, Spans, and Events; however,
you must [Enable Instrumentation](../README.md#set-up-via-serverless-framework-dashboard-ui) for each of
your functions for Serverless Framework Dashboard to ingest the data.

## Usage

The package does not require any configuration as the credentials are
automatically set on the AWS Lambda function environment variables when Tracing
is enabled in Serverless Framework Dashboard.

To use the Serverless SDK you must import the `sls_sdk` package in your
AWS Lambda function handler.

```python
from sls_sdk import serverlessSdk
```

### Capturing Errors

The most common use case for the Serverless SDK is to capture handled errors.
There are two mechanisms for capturing handled errors.

#### Using capture_error

```python
serverlessSdk.capture_error(Exception("Unexpected"))
```

#### Using logging

```python
import logging

logging.error("Logged error")
```

The Serverless SDK automatically instruments the `logging.error` method to
capture errors. This makes instrumentation much easier as you may already be
using `logging.error` to display the errors.

This method can be used to capture `Exception` objects, as well as any
combination of strings. If only an `Exception` object is provided, then the
stack trace in Serverless Framework Dashboard will show the stack trace of the error object. If a string, or a combination of a string and `Exception`, are provided, then the stack trace of the `logging.error` will be captured.

### Capturing Warnings

#### Using capture_warning

```python
serverlessSdk.capture_warning("Captured warning")
```

#### Using logging.warning

```python
import logging

logging.warning("Logged warning %s %s", 12, True)
```

The Serverless SDK automatically instruments the `logging.warning` method to
capture warnings. This makes instrumentation easier as you may already be using
`logging.warning` to display warnings.

This method only supports capturing strings.

We recommend avoiding using unique instance values for the strings. For example,
if you need to include a userId, email, request ID, or any ID that may be unique
to the individual invocation, we recommend using Tagging instead.

This method will capture the stack trace of the `logging.warning` call so it
is easy to identify in Serverless Framework Dashboard.

### Tagging

#### Setting Tags on the Trace

```python
serverlessSdk.set_tag("userId", user_id)
```

Using the `set_tag` method will create Tags associated with the entire Trace.
You'll be able to see the Tags on the Trace Details page in the Trace Explorer.

All Tags set with `set_tag` are also inherited by all the Captured Errors and
Captured Warnings.

Tag keys may only contain alphanumeric, `.`, `-`, and `_` characters. Tag values
may contain any string value. Invalid tag keys will not throw errors, instead,
an SDK error will be made available in Dev Mode and Trace Details.

#### Settings Tags with console.error and console.warn

```python
import logging

serverlessSdk.set_tag("userId", user_id)

logging.error("Logged error")
logging.warning("Logged warning %s %s", 12, True)
```

Using `set_tag` sets the Tag values on both the Trace and all Captured Errors
and Captured Warnings. Captured Errors and Captured Warnings can be created
using the `logging.error` and `logging.warning` methods. Therefore, Tags set
with `set_tag` will apply to all Captured Errors and Captured Warnings
created using `logging.error` and `logging.warning`.

#### Setting Tags on Captured Errors

```python
serverlessSdk.capture_error(
    Exception("Captured error"),
    tags={"userId": "example", "invocationId": invocation_id},
)
```

Tags can also be set on the individual error. If you previously set a Tag using
`set_tag` then the Tags set on `capture_error` will override the Tags on the
Captured Error, while keeping the Tag on the trace unmodified.

Tag keys on `capture_error` are validated the same way as tag keys on `set_tag`.

#### Setting Tags on Captured Warnings

```python
serverlessSdk.capture_warning(
    "Captured warning",
    tags={"userId": "example", "invocationid": invocation_id},
)
```

Tags can also be added on the individual Captured Warnings, just like Captured
Errors.

Tag keys on `capture_warning` are validated the same way as tag keys on
`set_tag`.

### Capturing Unhandled Exceptions with Flask

Serverless Framework Dashboard will capture unhandled exceptions thrown from the handler method. This can be achieved without including the `sls_sdk` package, as
it is provided by the AWS Lambda Layer added to your Lambda function when
instrumentation is enabled.

If you are using Flask, it will automatically handle unhandled exceptions. As a
result, the exceptions do not propagate to the handler or the Serverless Framework Dashboard instrumentation layer. You can set the `PROPAGATE_EXCEPTIONS` configuration
property in Flask for it to propagate the exception and make it available to
Serverless Framework Dashboard. This will enable you to search for traces with unhandled exceptions in Serverless Framework Dashboard.

```python
app.config['PROPAGATE_EXCEPTIONS'] = True
```

Note, changing this behavior changes the behavior of the handler response so other updates may be necessary.

### Structured Logs with capture_error and capture_warning

The `capture_warning` and `capture_error` methods will send the content to
Serverless Framework Dashboard in a binary format. To enable human-readability these
methods will also output a structured-log JSON string, like the one shown
below.

This string is easier to read, and can also be used with other tools like
CloudWatch Log Insights to parse and search.

```json
{
  "source": "serverlessSdk",
  "type": "ERROR_TYPE_CAUGHT_USER",
  "message": "User not found",
  "stackTrace": "...",
  "tags": {
    "userId": "eb661c69405c"
  }
}
```

To disable the output of the structured logs with `capture_error` and
`capture_warning`, set this environment variable in the runtime.

```bash
SLS_DISABLE_CAPTURED_EVENTS_STDOUT=true
```

### Custom Spans

Spans are part of the Trace that show when something started and stopped. Spans
can be nested and they can contain Events. Spans are automatically created by
the Serverless SDK for AWS and HTTP requests. These methods show you how you can
create your own custom spans and nest them.

#### Creating a Custom Span

```python
from sls_sdk import serverlessSdk
span = serverlessSdk.create_span('some-label')
# some work
span.close()
```

#### Create a Custom Span using `with`

Instead of creating a span and stopping it using `close()`, you can also use
`with` to automatically stop the span.

```python
from sls_sdk import serverlessSdk

with serverlessSdk.create_span('some-label'):
    pass # the execution of this `with` statement will be captured as a span
```

#### Create a nested Span

Spans can also be nested by calling the `create_span` method inside another.

```python
from sls_sdk import serverlessSdk

span1 = serverlessSdk.create_span('span1')
span2 = span1.create_span('span2')

# do some work
span2.close()
# do additional work
span1.close()
```

Child spans must be stopped via `close()` before the parent Span is stopped. If
a parent span is stopped, then all child spans will be stopped.

### Setting a custom endpoint

When using a mono-lambda architecture, in which a single lambda function with a
framework like Flask is routed from a single API Gateway endpoint, the
request on API Gateway is captured as a proxy endpoint. As a result, the request
may appear as `/{proxy+}` instead of the intended path. The Serverless SDK
automatically instruments Flask to capture the correct endpoint. This enables
you to filter for HTTP requests using the intended path.

In some cases, it may be necessary to manually set the endpoint. In such cases
you can use the `set_endpoint` method to customize the endpoint path.

```python
serverlessSdk.set_endpoint('/my/custom/endpoint')
```
