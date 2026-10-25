---
order: 1
title: Playground tour
description: Explore realistic responses in a local-only sandbox.
group: Get started
---

## Your first mock response

1. Select **API Reference** and open **List projects**.
2. Choose **Try now** to open the resizable playground.
3. Select **Send mock**. A nested example response appears immediately.
4. Collapse or expand its JSON, copy the complete response, or open it fullscreen.

## Explore success and error cases

Open **Mock response options** in the request pane. Choose a documented status and generate it. Named examples show curated responses; **Generate from schema** produces repeatable data for the chosen seed.

Try **Create a project** to inspect a JSON request body, or **Delete a project** to preview a body-free 204 response. These actions generate local previews. They do not validate a real service, mutate a resource or require a confirmation for a live request.

## Request examples

Switch between cURL, JavaScript, TypeScript, Python and Java, then copy an example. The `https://demo.orbit.invalid/v1` address is illustrative and deliberately has no live service. The URL is read-only, and this demo always generates responses locally.

For your own documentation, the default playground mode sends real requests to your API. The demo explicitly enables `explorer.mode: mock` in its YAML configuration.
