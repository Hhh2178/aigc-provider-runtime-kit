import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { materializeTaskOutputs, resolveServedFile, mimeTypeFor } from "@aigc-kit/control-center/worker/materialize";

function bytesFetcher(payload, status = 200) {
  return async () => new Response(new TextEncoder().encode(payload), {
    status,
    headers: { "content-length": String(payload.length) }
  });
}

test("materialization downloads outputs and rewrites materialized URLs", async (t) => {
  const storageDir = await mkdtemp(join(tmpdir(), "cc-materialize-"));
  t.after(() => rm(storageDir, { recursive: true, force: true }));

  const outcome = await materializeTaskOutputs({
    imageUrls: ["https://cdn.example.com/a.png", "data:image/png;base64,QUJD"],
    videoUrls: ["https://cdn.example.com/v.mp4"],
    audioUrls: []
  }, { storageDir, taskId: "task-abc", fetcher: bytesFetcher("FAKEBYTES") });

  assert.equal(outcome.warnings.length, 0);
  assert.deepEqual(outcome.downloaded.length, 2);
  const images = outcome.result.materializedImageUrls;
  assert.equal(images[0], "/api/tasks/task-abc/files/1-a.png");
  assert.equal(images[1], "data:image/png;base64,QUJD", "data urls pass through");
  assert.deepEqual(outcome.result.materializedVideoUrls, ["/api/tasks/task-abc/files/1-v.mp4"]);

  const stored = await readFile(join(storageDir, "task-abc", "1-a.png"), "utf8");
  assert.equal(stored, "FAKEBYTES");
  const files = await readdir(join(storageDir, "task-abc"));
  assert.equal(files.length, 2);
});

test("failed or oversized downloads keep remote URLs with warnings", async (t) => {
  const storageDir = await mkdtemp(join(tmpdir(), "cc-materialize-"));
  t.after(() => rm(storageDir, { recursive: true, force: true }));

  const outcome = await materializeTaskOutputs({
    imageUrls: ["https://cdn.example.com/broken.png", "https://cdn.example.com/huge.png"]
  }, {
    storageDir,
    taskId: "task-warn",
    fetcher: async (url) => {
      if (String(url).includes("huge")) return new Response("x".repeat(64), { status: 200, headers: { "content-length": "64" } });
      return new Response("boom", { status: 500 });
    },
    maxBytes: 32
  });

  assert.equal(outcome.warnings.length, 2);
  assert.equal(outcome.result.materializedImageUrls, undefined, "all failed: no materialized bucket");
  const dir = await readdir(join(storageDir, "task-warn")).catch(() => []);
  assert.ok(dir.length <= 1, "failed files must not linger (oversized may leave a partial that was removed)");
});

test("traversal-resistant path resolution", () => {
  const root = resolve("C:/storage");
  assert.ok(resolveServedFile(root, "task-1", "1-a.png")?.endsWith(join("task-1", "1-a.png")));
  assert.equal(resolveServedFile(root, "task-1", "../secret.txt"), null);
  assert.equal(resolveServedFile(root, "task-1", "sub/../../x"), null);
  const oddTask = resolveServedFile(root, "task/../1", "a.png");
  assert.ok(oddTask && oddTask.includes("task_.._1"), "odd ids are sanitized into a single safe segment");
  assert.ok(oddTask.startsWith(root), "still inside the storage root");
  assert.equal(resolveServedFile(root, "task-1", ".."), null);
});

test("mimeTypeFor covers media types", () => {
  assert.equal(mimeTypeFor("x.png"), "image/png");
  assert.equal(mimeTypeFor("x.mp4"), "video/mp4");
  assert.equal(mimeTypeFor("x.wav"), "audio/wav");
  assert.equal(mimeTypeFor("x.unknown"), "application/octet-stream");
});
