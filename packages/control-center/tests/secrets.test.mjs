import test from "node:test";
import assert from "node:assert/strict";
import { createSecretCodec } from "@aigc-kit/control-center/crypto";

test("secret codec roundtrips AES-256-GCM storage format", () => {
  const codec = createSecretCodec("unit-test-secret");
  const stored = codec.encrypt("sk-live-abcdef123456");

  assert.ok(stored.startsWith("enc:v1:"));
  assert.equal(stored.split(":").length, 5);
  assert.notEqual(stored.includes("sk-live"), true);
  assert.equal(codec.decrypt(stored), "sk-live-abcdef123456");
});

test("secret codec masks previews and tolerates unknown payloads", () => {
  const codec = createSecretCodec("unit-test-secret");
  const stored = codec.encrypt("sk-live-abcdef123456");

  assert.equal(codec.preview(stored), "...3456");
  assert.equal(codec.preview("plain-key-7777"), "...7777");
  assert.equal(codec.preview(""), "");

  const otherCodec = createSecretCodec("different-root");
  assert.equal(otherCodec.decrypt(stored), "");

  assert.equal(codec.decrypt("raw-plain-key"), "raw-plain-key");
  assert.equal(codec.decrypt("enc:v1:broken:payload"), "");
  assert.equal(codec.encrypt(""), "");
});
