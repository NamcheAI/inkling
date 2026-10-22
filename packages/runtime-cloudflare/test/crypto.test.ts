import assert from "node:assert/strict";
import test from "node:test";

import { Effect, Either } from "effect";

import { SecretHasherLive } from "@earendil-works/inkling-backend";
import { SecretHasher } from "@earendil-works/inkling-core";

import { CloudflareSecretHasherLive, workersPbkdf2IterationLimit } from "../src/crypto.ts";

// Deployed Workers reject PBKDF2 above 100,000 iterations; local workerd and
// Node do not. Reproduce the platform's rejection so the cap is tested here.
async function withWorkersPbkdf2Limit<A>(run: () => Promise<A>): Promise<A> {
  const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
  const original = crypto.subtle.deriveBits;
  crypto.subtle.deriveBits = (async (algorithm, key, length) => {
    const iterations = (algorithm as Pbkdf2Params).iterations;
    if (iterations > workersPbkdf2IterationLimit) {
      throw new DOMException(
        `Pbkdf2 failed: iteration counts above 100000 are not supported (requested ${iterations}).`,
        "NotSupportedError",
      );
    }
    return deriveBits(algorithm, key, length);
  }) as typeof crypto.subtle.deriveBits;
  try {
    return await run();
  } finally {
    crypto.subtle.deriveBits = original;
  }
}

const hashAndVerify = Effect.flatMap(SecretHasher, (hasher) =>
  Effect.flatMap(hasher.hash("session-token"), (hash) =>
    Effect.map(hasher.verify("session-token", hash), (verified) => ({ hash, verified })),
  ),
);

test("session hashing stays within the Workers PBKDF2 limit", async () => {
  const [unbounded, cloudflare] = await withWorkersPbkdf2Limit(() =>
    Promise.all([
      Effect.runPromise(Effect.either(hashAndVerify.pipe(Effect.provide(SecretHasherLive)))),
      Effect.runPromise(hashAndVerify.pipe(Effect.provide(CloudflareSecretHasherLive))),
    ]),
  );

  // The default hasher's 310,000 iterations are what broke sign-in on Workers.
  assert.equal(Either.isLeft(unbounded), true);
  assert.match(cloudflare.hash, /^pbkdf2-sha256\$100000\$/u);
  assert.equal(cloudflare.verified, true);
});
