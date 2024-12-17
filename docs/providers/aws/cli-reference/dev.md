<!--
title: Serverless Framework Commands - Dev
menuText: Serverless Console Dev Mode
menuOrder: 1
description: Launch a Serverless Console dev mode session in the terminal
layout: Doc
-->

<!-- DOCS-SITE-LINK:START automatically generated  -->

### [Read this on the main serverless docs site](https://www.serverless.com/framework/docs/providers/aws/cli-reference/dev/)

<!-- DOCS-SITE-LINK:END -->

# Dev

The `serverless dev` command will launch a [Serverless Console Dev Mode](https://www.serverless.com/console/docs/application-guide/dev-mode) session in your terminal.

```bash
serverless dev
```

## Options

- `--org` The organization that your AWS account is associated with in Serverless Console.
- `--region` or `-r` The region in that your function was deployed to.
- `--stage` or `-s` The stage in your service was deploy to.
- `--function` or `-f` The name of the function that you want to focus your dev mode activity on. If this option is excluded then all function activity will be streamed to your terminal.
- `--verbose` or `-v` If this flag is included all span input/output and lambda request/response data will be streamed to the terminal.

## Examples

### Start dev mode interactively selecting an organization

```bash
serverless dev
```

### Start dev mode with an org pre selected

```bash
serverless dev --org myorg
```

### Start dev mode with an org pre selected and all input output information logged

```bash
serverless deploy function --function helloWorld --update-config
```
