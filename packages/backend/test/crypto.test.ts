import assert from "node:assert/strict";
import test from "node:test";

import { Effect } from "effect";

import { SecretHasher, TokenHasher } from "@earendil-works/inkling-core";

import { SecretHasherLive, secretHasherLayer, TokenHasherLive } from "../src/index.ts";

test("a capped secret hasher records its iteration count and verifies across settings", async () => {
  const capped = await Effect.runPromise(
    Effect.flatMap(SecretHasher, (hasher) => hasher.hash("session-token")).pipe(
      Effect.provide(secretHasherLayer(100_000)),
    ),
  );
  assert.match(capped, /^pbkdf2-sha256\$100000\$/u);

  const [cappedByDefault, defaultByCapped, wrongSecret] = await Promise.all([
    Effect.runPromise(
      Effect.flatMap(SecretHasher, (hasher) => hasher.verify("session-token", capped)).pipe(
        Effect.provide(SecretHasherLive),
      ),
    ),
    Effect.runPromise(
      Effect.flatMap(SecretHasher, (hasher) =>
        Effect.flatMap(hasher.hash("api-key"), (hash) => hasher.verify("api-key", hash)),
      ).pipe(Effect.provide(secretHasherLayer(100_000))),
    ),
    Effect.runPromise(
      Effect.flatMap(SecretHasher, (hasher) => hasher.verify("other-token", capped)).pipe(
        Effect.provide(SecretHasherLive),
      ),
    ),
  ]);
  assert.equal(cappedByDefault, true);
  assert.equal(defaultByCapped, true);
  assert.equal(wrongSecret, false);
});

test("token hashes are single digests and PBKDF2 token hashes still verify once", async () => {
  const legacy = await Effect.runPromise(
    Effect.flatMap(SecretHasher, (hasher) => hasher.hash("session-token")).pipe(
      Effect.provide(secretHasherLayer(100_000)),
    ),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const hasher = yield* TokenHasher;
      const current = yield* hasher.hash("session-token");
      return {
        current,
        currentOutdated: hasher.isOutdated(current),
        currentValid: yield* hasher.verify("session-token", current),
        legacyOutdated: hasher.isOutdated(legacy),
        legacyValid: yield* hasher.verify("session-token", legacy),
        wrongCurrent: yield* hasher.verify("other-token", current),
        wrongLegacy: yield* hasher.verify("other-token", legacy),
      };
    }).pipe(Effect.provide(TokenHasherLive)),
  );
  assert.match(result.current, /^sha256\$/u);
  assert.equal(result.currentOutdated, false);
  assert.equal(result.currentValid, true);
  assert.equal(result.legacyOutdated, true);
  assert.equal(result.legacyValid, true);
  assert.equal(result.wrongCurrent, false);
  assert.equal(result.wrongLegacy, false);
});
