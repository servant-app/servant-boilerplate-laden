<!--
title: Serverless Framework - AWS Lambda Events - Scheduled & Recurring
menuText: Schedule
menuOrder: 6
description: Setting up Scheduled, Recurring, CRON Task Events with AWS Lambda via the Serverless Framework
layout: Doc
-->

<!-- DOCS-SITE-LINK:START automatically generated  -->

### [Read this on the main serverless docs site](https://www.serverless.com/framework/docs/providers/aws/events/schedule)

<!-- DOCS-SITE-LINK:END -->

# Schedule

The following config will attach a schedule event and causes the function `crawl` to be called every 2 hours. The configuration allows you to attach multiple schedules to the same function. You can either use the `rate` or `cron` syntax. Take a look at the [AWS schedule syntax documentation](http://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html) for more details.

```yaml
functions:
  crawl:
    handler: crawl
    events:
      - schedule: rate(2 hours)
      - schedule: cron(0 12 * * ? *)
```

## Enabling / Disabling

**Note:** `schedule` events are enabled by default.

This will create and attach a schedule event for the `aggregate` function which is disabled. If enabled it will call
the `aggregate` function every 10 minutes.

```yaml
functions:
  aggregate:
    handler: statistics.handler
    events:
      - schedule:
          rate: rate(10 minutes)
          enabled: false
          input:
            key1: value1
            key2: value2
            stageParams:
              stage: dev
      - schedule:
          rate: cron(0 12 * * ? *)
          enabled: false
          inputPath: '$.stageVariables'
      - schedule:
          rate: rate(2 hours)
          enabled: true
          inputTransformer:
            inputPathsMap:
              eventTime: '$.time'
            inputTemplate: '{"time": <eventTime>, "key1": "value1"}'
```

## Specify Name and Description

Name and Description can be specified for a schedule event. These are not required properties.

```yaml
events:
  - schedule:
      name: your-scheduled-rate-event-name
      description: 'your scheduled rate event description'
      rate: rate(2 hours)
```

## Specify multiple schedule expressions

An array of schedule expressions (i.e. using either `rate` or `cron` syntax) can be specified, in order to avoid repeating other configuration variables.
This is specially useful in situations in which there's no other way than using multiple cron expressions to schedule a function.

This will trigger the function at certain times on weekdays and on different times on weekends, using the same input:

```yaml
functions:
  foo:
    handler: foo.handler
    events:
      - schedule:
          rate:
            - cron(0 0/4 ? * MON-FRI *)
            - cron(0 2 ? * SAT-SUN *)
          input:
            key1: value1
            key2: value2
```

## Use AWS::Scheduler::Schedule instead of AWS::Event::Rule

**Note**: `scheduler` does not accept the `inputPath` or `inputTransformer` options. If you need these, use the default `eventBus` option

AWS has account-wide limits on the number of `AWS::Event::Rule` triggers per bus (300 events), and all Lambda schedules go into a single bus with no way to override it.
This can lead to a situation where large projects hit the limit with no ability to schedule more events.

However, `AWS::Scheduler::Schedule` has much higher limits (1,000,000 events), and is configured identically.
`method` can be set in order to migrate to this trigger type seamlessly. It also allows you to specify a timezone to run your event based on local time.
The default method is `eventBus`, which configures an `AWS::Event::Rule`.

```yaml
functions:
  foo:
    handler: foo.handler
    events:
      - schedule:
          method: scheduler
          rate:
            - cron(0 0/4 ? * MON-FRI *)
          timezone: America/New_York
          input:
            key1: value1
            key2: value2
          deadLetterTargetArn: !GetAtt DLQ.Arn
```
