import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "@aigc-kit/control-center/db";
import { createSecretCodec } from "@aigc-kit/control-center/crypto";
import { createProviderRepository } from "@aigc-kit/control-center/repository/providers";
import { createTaskRepository } from "@aigc-kit/control-center/repository/tasks";
import { createAuthRepository } from "@aigc-kit/control-center/repository/auth";

// Integration tests run only against a disposable PostgreSQL database.
//   CC_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/control_center_test npm test
const databaseUrl = process.env.CC_TEST_DATABASE_URL || "";

test("pg integration: migrations, admin auth, provider upsert, task claim lifecycle", {
  skip: databaseUrl ? false : "CC_TEST_DATABASE_URL not set"
}, async (t) => {
  const database = createDatabase(databaseUrl, () => {});
  await database.migrate();
  const codec = createSecretCodec("integration-test-secret");
  const providers = createProviderRepository(database.pool, codec, "default");
  const tasks = createTaskRepository(database.pool, "default");
  const auth = createAuthRepository(database.pool);

  t.after(async () => {
    await database.pool.query("delete from cc_task_events where task_id in (select id from cc_tasks where provider_id = $1)", ["it-provider"]);
    await database.pool.query("delete from cc_tasks where provider_id = $1", ["it-provider"]);
    await database.pool.query("delete from cc_providers where id = $1", ["it-provider"]);
    await database.pool.query("delete from cc_sessions where user_id in (select id from cc_admin_users where email = $1)", ["it-admin@example.com"]);
    await database.close();
  });

  t.test("admin bootstrap and password verification", async () => {
    const admin = await auth.ensureBootstrapAdmin({ email: "it-admin@example.com", password: "integration-pass" });
    assert.equal(admin.email, "it-admin@example.com");
    const okUser = await auth.verifyLogin("it-admin@example.com", "integration-pass");
    assert.ok(okUser);
    const badUser = await auth.verifyLogin("it-admin@example.com", "wrong");
    assert.equal(badUser, null);
  });

  t.test("provider secret roundtrip persists ciphertext only", async () => {
    const record = await providers.insertProviderRecord({
      id: "it-provider",
      name: "集成测试服务商",
      baseUrl: "https://api.example.com/v1",
      protocol: "openai",
      enabled: true,
      apiKey: codec.encrypt("sk-integration-123"),
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    const stored = await database.pool.query("select api_key_cipher from cc_providers where id = $1", ["it-provider"]);
    assert.ok(stored.rows[0].api_key_cipher.startsWith("enc:v1:"));
    assert.equal(stored.rows[0].api_key_cipher.includes("sk-integration-123"), false);

    const fetched = await providers.findProviderRecordById(record.id);
    assert.equal(codec.decrypt(fetched.apiKey || ""), "sk-integration-123");
    const updated = await providers.updateProviderRecord(record.id, (provider) => ({ ...provider, enabled: false }));
    assert.equal(updated.enabled, false);
  });

  t.test("task queue claim/poll/complete lifecycle", async () => {
    const task = await tasks.enqueueTask({
      capability: "image",
      providerId: "it-provider",
      protocol: "openai",
      payload: { capability: "image", prompt: "hi" },
      idempotencyKey: "it-key-1"
    });
    assert.equal(task.status, "queued");

    const idempotent = await tasks.enqueueTask({
      capability: "image",
      providerId: "it-provider",
      protocol: "openai",
      payload: { capability: "image", prompt: "hi" },
      idempotencyKey: "it-key-1"
    });
    assert.equal(idempotent.id, task.id);

    const claimed = await tasks.claimNextTask("it-worker");
    assert.ok(claimed);
    assert.equal(claimed.status, "running");
    assert.equal(claimed.claimedBy, "it-worker");

    await tasks.patchTaskResult(claimed.id, { runtimeStage: "polling", providerState: "POLLING" });
    const done = await tasks.completeTask(claimed.id, { imageUrls: ["https://cdn.example.com/x.png"], runtimeStage: "succeeded" });
    assert.equal(done.status, "succeeded");
    assert.ok(done.finalizedAt);

    const events = await tasks.readTaskEvents(claimed.id);
    const types = events.map((event) => event.type);
    assert.ok(types.includes("task.created"));
    assert.ok(types.includes("task.claimed"));
    assert.ok(types.includes("task.succeeded"));
  });
});
