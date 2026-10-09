import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRunningHubCatalogDraft } from "@aigc-kit/control-center/domain/runninghub/analyze";

test("analyze detects kind/target from doc URL and auto-switches", () => {
  const draft = analyzeRunningHubCatalogDraft({
    kind: "workflow",
    docUrl: "https://www.runninghub.cn/call-api/api-detail/1978404642654670849?apiType=4"
  });
  assert.equal(draft.detectedKind, "app");
  assert.equal(draft.detectedTargetId, "1978404642654670849");
  assert.ok(draft.autoSwitchMessage.includes("AI App"));
  assert.ok(draft.warnings.length >= 2);
});

test("analyze extracts input slots from requestExample.nodeInfoList", () => {
  const draft = analyzeRunningHubCatalogDraft({
    kind: "app",
    requestExample: JSON.stringify({
      webappId: "1978404642654670849",
      nodeInfoList: [
        { nodeId: "6", fieldName: "prompt", fieldValue: "一只门口的橘猫，写实风格" },
        { nodeId: "39", fieldName: "image", fieldValue: "" },
        { nodeId: "71", fieldName: "imagePrompt", fieldValue: "blue sky" }
      ]
    })
  });

  const fields = draft.sections.find((section) => section.key === "inputs").payload.fields;
  assert.equal(fields.length, 3);
  const promptField = fields.find((field) => field.fieldName === "prompt");
  assert.equal(promptField.nodeId, "6");
  assert.equal(promptField.required, true);
  const imageField = fields.find((field) => field.fieldName === "image");
  assert.equal(imageField.required, false);

  const params = draft.sections.find((section) => section.key === "params").payload;
  assert.equal(params.properties.prompt.title.length > 0, true);
  assert.deepEqual(params.required.sort(), ["imagePrompt", "prompt"].sort());

  const output = draft.sections.find((section) => section.key === "outputs").payload.outputs[0];
  assert.equal(output.path, "data");
});

test("analyze infers output kinds from responseExample URLs", () => {
  const draft = analyzeRunningHubCatalogDraft({
    kind: "workflow",
    runTargetId: "workflow-123",
    responseExample: JSON.stringify({
      data: {
        outputs: ["https://rh.example.com/a.png", "https://rh.example.com/b.jpg"],
        status: "SUCCESS"
      }
    })
  });

  const outputs = draft.sections.find((section) => section.key === "outputs").payload.outputs;
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].kind, "image");
  assert.equal(outputs[0].multiple, true);

  const execution = draft.sections.find((section) => section.key === "execution").payload;
  assert.equal(execution.endpoint, "/runninghub/workflow/workflow-123/run");
});

test("analyze falls back cleanly for invalid examples", () => {
  const draft = analyzeRunningHubCatalogDraft({
    kind: "app",
    requestExample: "不是JSON",
    responseExample: "也不是JSON"
  });
  assert.ok(draft.warnings.some((warning) => warning.includes("requestExample")));
  assert.ok(draft.warnings.some((warning) => warning.includes("responseExample")));
  const base = draft.sections.find((section) => section.key === "base").payload;
  assert.equal(base.runTargetId.length > 0, true);
});
