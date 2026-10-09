import test from "node:test";
import assert from "node:assert/strict";
import { assertTransition, projectTaskStatus, isTerminal } from "@aigc-kit/control-center/domain/task-machine";

test("status machine allows the production transitions only", () => {
  assert.doesNotThrow(() => assertTransition("queued", "running"));
  assert.doesNotThrow(() => assertTransition("queued", "cancelled"));
  assert.doesNotThrow(() => assertTransition("running", "succeeded"));
  assert.doesNotThrow(() => assertTransition("running", "failed"));
  assert.throws(() => assertTransition("queued", "succeeded"));
  assert.throws(() => assertTransition("succeeded", "failed"));
  assert.throws(() => assertTransition("cancelled", "running"));
  assert.equal(isTerminal("succeeded"), true);
  assert.equal(isTerminal("queued"), false);
});

test("status projection prefers materialized URLs and exposes display state", () => {
  const running = projectTaskStatus({
    status: "running",
    result: {
      runtimeStage: "polling",
      providerState: "POLLING",
      imageUrls: ["https://rh.example.com/a.png"],
      materializedImageUrls: []
    }
  });
  assert.equal(running.displayStatus, "executing");
  assert.equal(running.runtimeStage, "polling");
  assert.deepEqual(running.urls.imageUrls, ["https://rh.example.com/a.png"]);

  const done = projectTaskStatus({
    status: "succeeded",
    result: {
      runtimeStage: "materializing",
      imageUrls: ["https://rh.example.com/a.png"],
      materializedImageUrls: ["/storage/x.png"]
    }
  });
  assert.deepEqual(done.urls.imageUrls, ["/storage/x.png"]);

  const failed = projectTaskStatus({
    status: "failed",
    result: { error: "上游超时", failureCategory: "upstream_poll_timeout" }
  });
  assert.equal(failed.displayStatus, "failed");
  assert.equal(failed.message, "上游超时");
  assert.deepEqual(failed.urls.imageUrls, []);
});
