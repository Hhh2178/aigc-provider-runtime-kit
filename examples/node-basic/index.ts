import { defaultParameterSchemaForModel } from "../../packages/core/src/index.js";
import { buildRunningHubExecutionDescriptor } from "../../packages/runninghub/src/index.js";

const schema = defaultParameterSchemaForModel("image", "gpt-image-2", "openai");
const execution = buildRunningHubExecutionDescriptor({
  kind: "app",
  appId: "example-app",
  runTargetId: "example-app",
  taskCapability: "image",
  fields: []
});

console.log({ schema, execution });
