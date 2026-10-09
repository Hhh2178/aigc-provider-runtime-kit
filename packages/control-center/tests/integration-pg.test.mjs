import test from "node:test";
import assert from "node:assert/strict";
import { startTestDatabase, canRunIntegrationTests } from "./helpers/embedded-pg.mjs";

// Real-database integration tests. They boot embedded-postgres automatically
// (or reuse CC_TEST_DATABASE_URL); CC_TEST_SKIP_PG=1 opts out. No real service
// provider is ever contacted — this suite only exercises local infrastructure.
const runnable = await canRunIntegrationTests();

test("pg integration: migrations, admin auth, provider upsert, task claim lifecycle", {
  skip: runnable ? false : "no embedded-postgres and no CC_TEST_DATABASE_URL"
}, async (t) => {
  const database = await startTestDatabase();
  const { createDatabase } = await import("@aigc-kit/control-center/db");
  const { createSecretCodec } = await import("@aigc-kit/control-center/crypto");
  const { createProviderRepository } = await import("@aigc-kit/control-center/repository/providers");
  const { createTaskRepository } = await import("@aigc-kit/control-center/repository/tasks");
  const { createAuthRepository } = await import("@aigc-kit/control-center/repository/auth");

  const databaseInstance = createDatabase(database.url, () => {});
  await databaseInstance.migrate();
  const codec = createSecretCodec("integration-test-secret");
  const providers = createProviderRepository(databaseInstance.pool, codec, "default");
  const tasks = createTaskRepository(databaseInstance.pool, "default");
  const auth = createAuthRepository(databaseInstance.pool);

  t.after(async () => {
    await databaseInstance.pool.query("delete from cc_task_events where task_id in (select id from cc_tasks where provider_id = $1)", ["it-provider"]).catch(() => {});
    await databaseInstance.pool.query("delete from cc_tasks where provider_id = $1", ["it-provider"]).catch(() => {});
    await databaseInstance.pool.query("delete from cc_providers where id = $1", ["it-provider"]).catch(() => {});
    await databaseInstance.pool.query("delete from cc_sessions where user_id in (select id from cc_admin_users where email = $1)", ["it-admin@example.com"]).catch(() => {});
    await databaseInstance.pool.query("delete from cc_task_cost_items where task_id in (select id from cc_tasks where provider_id = $1)", ["it-provider"]).catch(() => {});
    await databaseInstance.pool.query("delete from cc_model_pricing where provider_id = $1", ["it-provider"]).catch(() => {});
    await databaseInstance.close().catch(() => {});
    await database.stop();
  });

  const taskIds = {};

  await t.test("schema migrations are idempotent", async () => {
    await databaseInstance.migrate();
    const applied = await databaseInstance.pool.query("select id from cc_schema_migrations order by id");
    assert.ok(applied.rows.length >= 2);
    const table = await databaseInstance.pool.query("select to_regclass('cc_tasks') as name");
    assert.equal(table.rows[0].name, "cc_tasks");
  });

  await t.test("admin bootstrap and password verification", async () => {
    const admin = await auth.ensureBootstrapAdmin({ email: "it-admin@example.com", password: "integration-pass" });
    assert.equal(admin.email, "it-admin@example.com");
    const okUser = await auth.verifyLogin("it-admin@example.com", "integration-pass");
    assert.ok(okUser);
    const badUser = await auth.verifyLogin("it-admin@example.com", "wrong");
    assert.equal(badUser, null);
  });

  await t.test("provider secret roundtrip persists ciphertext only", async () => {
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
    const stored = await databaseInstance.pool.query("select api_key_cipher from cc_providers where id = $1", ["it-provider"]);
    assert.ok(stored.rows[0].api_key_cipher.startsWith("enc:v1:"));
    assert.equal(stored.rows[0].api_key_cipher.includes("sk-integration-123"), false);

    const fetched = await providers.findProviderRecordById(record.id);
    assert.equal(codec.decrypt(fetched.apiKey || ""), "sk-integration-123");
    const updated = await providers.updateProviderRecord(record.id, (provider) => ({ ...provider, enabled: false }));
    assert.equal(updated.enabled, false);
  });

  await t.test("task queue claim/poll/complete lifecycle with idempotency", async () => {
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

    const secondClaim = await tasks.claimNextTask("it-worker-2");
    assert.equal(secondClaim, null, "a single queued task must be claimed exactly once");

    await tasks.patchTaskResult(claimed.id, { runtimeStage: "polling", providerState: "POLLING" });
    const withHeartbeat = await tasks.findTaskById(claimed.id);
    assert.equal(withHeartbeat.result.runtimeStage, "polling");

    const done = await tasks.completeTask(claimed.id, { imageUrls: ["https://cdn.example.com/x.png"], runtimeStage: "succeeded" });
    assert.equal(done.status, "succeeded");
    assert.ok(done.finalizedAt);

    const events = await tasks.readTaskEvents(claimed.id);
    const types = events.map((event) => event.type);
    assert.ok(types.includes("task.created"));
    assert.ok(types.includes("task.claimed"));
    assert.ok(types.includes("task.succeeded"));
  });

  await t.test("pricing and cost ledger cover model and RH catalog tasks", async () => {
    taskIds.costModel = (await tasks.enqueueTask({ capability: "image", providerId: "it-provider", protocol: "openai", payload: { capability: "image", generationCount: 2 } })).id;
    taskIds.costRh = (await tasks.enqueueTask({ capability: "video", providerId: "it-provider", protocol: "runninghub", payload: { capability: "video", runninghub: { catalogId: "it-provider:workflow:999", runTargetId: "999" } } })).id;
    taskIds.costUsage = (await tasks.enqueueTask({ capability: "image", providerId: "it-provider", protocol: "openai", payload: { capability: "image" } })).id;

    const { createPricingRepository } = await import("@aigc-kit/control-center/repository/pricing");
    const { normalizePricingInput } = await import("@aigc-kit/control-center/domain/cost");
    const pricingRepo = createPricingRepository(databaseInstance.pool, "default");

    await pricingRepo.upsertPricing(normalizePricingInput({ scope: "model", providerId: "it-provider", modelRecordId: "it-model", unitPrice: 0.25 }));
    await pricingRepo.upsertPricing(normalizePricingInput({ scope: "rh_target", providerId: "it-provider", runTargetId: "999", unitPrice: 1.5 }));

    const listed = await pricingRepo.listPricing("it-provider");
    assert.equal(listed.length, 2);
    assert.ok(listed.some((item) => item.scope === "rh_target"));

    const priced = await pricingRepo.recordTaskCost({
      id: taskIds.costModel,
      providerId: "it-provider",
      modelRecordId: "it-model",
      payload: { generationCount: 2 },
      result: { imageUrls: ["https://cdn.example.com/1.png"] }
    });
    assert.equal(priced.billedSource, "per_request");
    assert.equal(priced.amount, 0.5);

    const rhCost = await pricingRepo.recordTaskCost({
      id: taskIds.costRh,
      providerId: "it-provider",
      modelRecordId: undefined,
      payload: { runninghub: { catalogId: "it-provider:workflow:999", runTargetId: "999" } },
      result: { videoUrls: ["https://cdn.example.com/v.mp4"] }
    });
    assert.equal(rhCost.billedSource, "per_request", "RH catalog tasks are now pricable");
    assert.equal(rhCost.amount, 1.5);

    const summary = await pricingRepo.costSummary({ since: Date.now() - 3600_000 });
    assert.ok(summary.totalAmount >= 2);
    assert.ok(summary.items.length >= 2);

    // Upstream usage overrides configured pricing when present.
    const usage = await pricingRepo.recordTaskCost({
      id: taskIds.costUsage,
      providerId: "it-provider",
      modelRecordId: "it-model",
      payload: {},
      result: { providerUsage: { consumeMoney: "0.75" } }
    });
    assert.equal(usage.billedSource, "provider_usage");
    assert.equal(usage.amount, 0.75);

    await pricingRepo.deletePricing("price:model:it-provider:it-model");
    assert.equal((await pricingRepo.listPricing("it-provider")).length, 1);

    for (const id of [taskIds.costModel, taskIds.costRh, taskIds.costUsage]) {
      await tasks.cancelTask(id, "cost ledger test cleanup");
    }
  });

  await t.test("stale running tasks are requeued", async () => {
    const task = await tasks.enqueueTask({
      capability: "video",
      providerId: "it-provider",
      protocol: "openai",
      payload: { capability: "video" }
    });
    const claimed = await tasks.claimNextTask("it-worker");
    assert.ok(claimed);
    assert.equal(claimed.id, task.id);
    await databaseInstance.pool.query("update cc_tasks set updated_at = now() - interval '2 hours' where id = $1", [task.id]);
    const requeued = await tasks.requeueStaleRunningTasks(30);
    assert.ok(requeued >= 1);
    const after = await tasks.findTaskById(task.id);
    assert.equal(after.status, "queued");
  });
});
