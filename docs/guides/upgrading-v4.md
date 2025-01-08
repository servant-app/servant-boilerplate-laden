<!--
title: Serverless Framework - Upgrading to v4
description: Learn about the significant updates and changes in Serverless Framework Version 4, including new licensing requirements, authentication methods, and deprecated providers.
short_title: Upgrading to v4
keywords:
  [
    'Serverless Framework',
    'Version 4',
    'upgrade',
    'AWS',
    'licensing',
    'authentication',
    'TypeScript support',
    'auto-updating',
  ]
-->

<!-- DOCS-SITE-LINK:START automatically generated  -->

### [Read this on the main serverless docs site](https://www.serverless.com/framework/docs/guides/upgrading-v4/)

<!-- DOCS-SITE-LINK:END -->

# Upgrading to Serverless Framework V4

Serverless Framework Version 4 seeks to avoid breaking changes and disruptions for existing Services using the `aws` provider. Our commitment is to provide a stable and consistent framework, as we have strived to do for almost a decade.

Additionally, V.4 introduces significant updates and a re-architecture of the core, reflecting both an evolution in our business at Serverless Inc. and a commitment to innovation within the Framework. A lot has changed since we launched the Framework in 2015. We're more excited about the serverless space than ever, and there are many new opportunities to provide a better developer experience than ever.

Here is what you need to know about upgrading to V.4.

## License Changes

As we announced at the end of 2023, Serverless Framework CLI will continue to be free for individual developers and small businesses, but will no longer be free for Organizations that have greater than $2M in annual revenue. These Organizations will require a commercial Subscription.

These changes only apply to Serverless Framework V.4 and beyond and not to earlier versions. Serverless Framework V.3 will continue to be maintained via critical security and bug fixes through 2024.

All questions on pricing can be answered on our [pricing page](https://serverless.com/pricing).

Serverless Framework V.4 will walk you through purchasing a Subscription via our Dashboard if you simply run the `serverless` command. Subscriptions can be purchased via [credit card](https://app.serverless.com/settings/billing) or the [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-ok24yw6x5wcrg).

## Authentication Via Access Or License Keys

**_This is a breaking change if you do not set a Serverless Access Key or Serverless License Key._**

As part of the License changes, Serverless Framework now requires authentication via the Serverless Framework Dashboard or a Serverless License Key. This does not mean you have to pay for a Subscription. All users (free and paid) are now prompted by the CLI to sign in.

You can choose from 2 forms of authentication:

- **Serverless Framework Access Keys:** You can authenticate via Access Key by signing in to Serverless Framework Dashboard when prompted by the CLI or running `serverless login`. When you do this, the CLI will auto-create a Serverless Access Key and save it on your machine. This approach is best if your entire team is comfortable signing into and using the [Serverless Framework Dashboard](https://app.serverless.com). To use this method in CI/CD pipelines, go to the [Access Keys view in Serverless Framework Dashboard](https://app.serverless.com/settings/accessKeys), create a new Access Key for CI/CD use, and save it as the `SERVERLESS_ACCESS_KEY` environment variable in your CI/CD pipeline.

- **Serverless Framework License Keys:** Alernatively, you can authenticate via a License Key. This approach is best if you do not want to use Serverless Framework Dashboard or you do not want to require your entire team to sign into the Dashboard. If you purchase a Subscription, you can create as many License Keys as you'd like within the [License Key view in Serverless Framework Dashboard](https://app.serverless.com/settings/licenseKeys) and distribute them to your team. Your team members and CI/CD pipelines will need to set the `SERVERLESS_LICENSE_KEY` environment variable with a License Key to use the Framework.

## Deprecation Of Non-AWS Providers

**_This is a breaking change for all users of Providers other than Amazon Web Services._**

Over the years, we've extended support to various providers, but achieving a unified abstraction across the diverse serverless offerings of each vendor has been challenging. This has led to AWS forming the majority of our user base.

Moving forward, we plan to revisit support for other vendors through the introduction of Serverless Framework Extensions. Simultaneously, we've made the decision to deprecate all providers except AWS. This decision is aimed at simplifying the core user experience.

## Environment Variables Loaded By Default

In previous versions of Serverless Framework (<= V.3), the `useDotEnv` configuration in `serverless.yml` would have to be set in order to load `.env` and `.env.[stage]` files, and make their environment variables accessible within `serverless.yml`.

In V.4, these files are read automatically, without the `useDotEnv` property.

## Revised Dev Mode

In previous versions of Serverless Framework (<= V.3), the `dev` command would work exclusively with Serverless Console or Serverless Framework Dashboard. However, `dev` has been completely re-imagined to only work with the CLI, not requiring Dashboard, and proxy events from your live AWS Lambda functions to your local code, enabling you to develop faster than ever.

Learn more about the new [dev mode](https://www.serverless.com/framework/docs/providers/aws/cli-reference/dev).

## Native Typescript Support

In V.4, [esbuild](https://github.com/evanw/esbuild) is included within Serverless Framework, allowing you to use Typescript files directly in your AWS Lambda function handlers and have your code build automatically upon deploy, without a plugin and without configuration.

Please note, plugins that build your code will not work unless you opt out of the default build experience. Some of the plugins affected are:

- `serverless-esbuild`
- `serverless-webpack`
- `serverless-plugin-typescript`

To learn more about this, check out the [building guide](https://www.serverless.com/framework/docs/providers/aws/guide/building).

## Auto-Updating

Auto-updating has been introduced in Serverless Framework V.4. This is checked once every day, and can be manually updated via `serverless update`.

## Git Resolvers Plugin

Git-related Serverless Framework Variables have been introduced into the Variable system.

As a result, the [Serverless Git Variables Plugin](https://github.com/jacob-meacham/serverless-plugin-git-variables) no longer works.

## Updated stages syntax

In V.4 there is a new global stages syntax that allows you to define parameters for each stage. This is not a breaking change for the previous `stages` syntax; however, the new syntax is recommended.

The old V.3 syntax:

```yaml
params:
  default:
    key1: devValue
  prod:
    key1: prodValue
```

The new V.4 syntax:

```yaml
stages:
  default:
    params:
      key1: devValue
  prod:
    params:
      key1: prodValue
```

The functionality is similar, but parameters should be defined under `stages.<stage>.params` instead of just `params.<stage>`.
