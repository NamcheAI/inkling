import assert from "node:assert/strict";
import test from "node:test";

import { Effect } from "effect";

import { SecretHasher } from "@earendil-works/inkling-core";

import { SecretHasherLive, secretHasherLayer } from "../src/index.ts";

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
