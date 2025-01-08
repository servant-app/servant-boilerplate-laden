<!--
title: Serverless Dashboard - CI/CD Best Practices
description: Best practices for using CI/CD with Serverless Framework to manage and deploy services at scale.
short_title: Serverless Dashboard - Best Practices
keywords:
  [
    'Serverless Framework',
    'CI/CD',
    'Best Practices',
    'Deployment',
    'Automation',
  ]
-->

<!-- DOCS-SITE-LINK:START automatically generated  -->

### [Read this on the main serverless docs site](https://serverless.com/framework/docs/guides/cicd/best-practices/)

<!-- DOCS-SITE-LINK:END -->

# Serverless CI/CD Best Practices

Break down your serverless application so that each of followings have their own repository and deployment pipeline:

* Ephemeral environment and all its associated ephemeral resources such as AWS Lambda etc. This ensures that they can be deployed and rolled-back at the same time making it easier to spin-up and discard the ephemeral environment.
* Shared resources with long spin-up time e.g. AWS RDS cluster. This way, your ephemeral environments can use the same resource which makes their deployments faster and cheaper.
*  Shared infrastructure resources such as virtual private network and subnet, also known as landing zones. 

Serverless Framework provides a lot of capabilities out of the box to help you break up your app, manage and deploy
your services. As your teams grow and the number of services grow, it can be difficult to know
the best way to organize your services for scale.

To help you manage and deploy your services at scale, check out the
[Serverless CI/CD Workflow Guide](https://www.serverless.com/guide-ci-cd) for our recommendations
on organizing your apps, services, repos and automating your release process.
