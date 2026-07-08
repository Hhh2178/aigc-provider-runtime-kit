# Getting Started

## Purpose

This guide helps host applications adopt `aigc-provider-runtime-kit` without copying private implementation details from another product.

## Install

```bash
npm install aigc-provider-runtime-kit
```

For local development from the repository:

```bash
npm ci
npm run build
npm test
```

## Provider Schema Example

```ts
import {
  defaultParameterSchemaForModel,
  uiMetadataFromSchema
} from "aigc-provider-runtime-kit/core";

const schema = defaultParameterSchemaForModel("image", "gpt-image-2", "openai");
const ui = uiMetadataFromSchema(schema, "image");
```

Use this when your host app needs a stable model configuration layer that can drive forms, nodes, or admin configuration screens.

## RunningHub Descriptor Example

```ts
import { buildRunningHubExecutionDescriptor } from "aigc-provider-runtime-kit/runninghub";

const descriptor = buildRunningHubExecutionDescriptor({
  kind: "workflow",
  workflowId: "workflow-id",
  taskCapability: "video",
  fields: []
});
```

The descriptor is intentionally host-app friendly: it describes what to submit, how to poll, and how outputs should be interpreted, but it does not own your database, queue, or permission model.

## Recommended Host Integration

1. Store provider and key records in your own secure database.
2. Use this package to normalize model schemas and RunningHub execution contracts.
3. Keep credentials on the server side only.
4. Wrap provider calls with your own audit, quota, and permission checks.
5. Add integration tests around the host app boundary.

## What This Kit Does Not Do

- It does not store credentials.
- It does not provide an admin UI.
- It does not run a hosted worker service.
- It does not enforce end-user permissions.
- It does not include private application schemas.
