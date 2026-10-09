import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt } from "node:crypto";
import { Client } from "pg";

/**
 * Self-hosted PostgreSQL for integration tests.
 *
 * - Honors CC_TEST_DATABASE_URL when provided (external/disposable server).
 * - Otherwise boots embedded-postgres in a temp dir. On Windows with a Chinese
 *   system locale, initdb's post-bootstrap step dies on GBK bytes vs UTF8; with
 *   `--no-clean` the bootstrapped cluster is still fully serviceable, so we
 *   tolerate that specific failure and start the server anyway (verified:
 *   template1 answers queries and CREATE DATABASE works).
 */

let active = null;

export async function startTestDatabase() {
  if (active) return active;
  const external = (process.env.CC_TEST_DATABASE_URL || "").trim();
  if (external) {
    active = { url: external, stop: async () => {} };
    return active;
  }

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const port = 54000 + randomInt(0, 5000);
  const databaseDir = await mkdtemp(join(tmpdir(), "cc-it-pg-"));
  const initdbFlags = ["--locale=C", "--encoding=UTF8"];
  if (process.platform === "win32") initdbFlags.push("--no-clean");
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "pw",
    port,
    persistent: false,
    initdbFlags,
    onLog: () => {}
  });

  try {
    await pg.initialise();
  } catch (error) {
    if (!existsSync(join(databaseDir, "PG_VERSION"))) {
      await rm(databaseDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    // Windows locale fallback: cluster is bootstrapped, post-bootstrap failed.
  }
  await pg.start();

  const adminClient = new Client({ host: "127.0.0.1", port, user: "postgres", password: "pw", database: "template1" });
  try {
    await adminClient.connect();
    await adminClient.query('create database cc_it');
  } finally {
    await adminClient.end().catch(() => {});
  }

  active = {
    url: `postgres://postgres:pw@127.0.0.1:${port}/cc_it`,
    stop: async () => {
      await pg.stop().catch(() => {});
      await rm(databaseDir, { recursive: true, force: true }).catch(() => {});
    }
  };
  return active;
}

export async function canRunIntegrationTests() {
  if (process.env.CC_TEST_SKIP_PG === "1") return false;
  if ((process.env.CC_TEST_DATABASE_URL || "").trim()) return true;
  try {
    await import("embedded-postgres");
    return true;
  } catch {
    return false;
  }
}
