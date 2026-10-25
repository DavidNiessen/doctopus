---
order: 3
title: Install Doctopus
description: Choose a setup, build your first site and find the right integration.
group: Get started
---

## From this demo to your own documentation

This demo uses fictional Orbit data. The guides below document **Doctopus itself**: installing the tool, supplying your OpenAPI YAML or JSON, writing guides and publishing your site.

Start with the [installation and usage guide](setup.md). It walks through a working source installation and clearly distinguishes optional services. The renamed packages are not yet published; use the documented source workflow rather than assuming a registry release is available.

## Choose your setup

1. **Host a static site.** [Build and publish a static site](setup.md#heading-deploy-a-static-publication) on your preferred host. No application server or database is needed at runtime.
2. **Use an existing Java application.** Follow the [Spring Boot installation](setup.md#heading-integrate-with-spring-boot) to serve documentation from your application.
3. **Use an existing Node.js application.** Follow the [Express and Fastify installation](setup.md#heading-integrate-with-express-or-fastify) to mount the built site in your app.
4. **Manage projects centrally.** Follow the [Server and Studio installation](setup.md#heading-install-server-and-studio) for projects, access and publications. This setup needs PostgreSQL and artifact storage.
5. **Automate approved builds.** [Add a Worker](setup.md#heading-add-automated-builds-with-a-worker) to the management platform on a separate build host.

Node.js and the CLI are needed at build time for every setup. Static sites and Java integrations do not need a Node process at runtime. Studio, Worker and PostgreSQL are optional for a simple documentation UI.

## Find your next guide

- **Installation:** [full walkthrough](setup.md), [CLI commands](cli.md), and [packages and releases](packages.md).
- **Integrations:** [Spring Boot and Node.js](../integrations/frameworks.md), [OpenAPI import](../integrations/openapi-import.md), and [supported specifications](../integrations/openapi-support.md).
- **Authoring:** [write guides](../authoring/guides.md), [configure your site](../authoring/customization.md), [build plugins](../authoring/plugins.md), [versions](../authoring/versions.md), and [languages](../authoring/languages.md).
- **Playground:** [authentication](../playground/authentication.md), [request bodies](../playground/request-bodies.md), [parameters](../playground/parameters.md), and [mock responses](../playground/mock-responses.md).
- **Operations:** [Server and Studio](../operations/server.md), [build management](../operations/studio-builds.md), [Worker setup](../operations/worker.md), [deployment and recovery](../operations/deployment.md), [offline installation](../operations/offline.md), and [diagnostics](../operations/diagnostics.md).

The sidebar follows these groups in reading order. Use **Documentation** to browse the handbook, **API Reference** for the fictional Orbit endpoints, or search for a topic. Each guide has its own static URL and remains readable without JavaScript.
