import { secretHasherLayer } from "@earendil-works/inkling-backend";

/**
 * Cloudflare Workers reject PBKDF2 above 100,000 iterations with a
 * NotSupportedError. Local workerd does not enforce the cap, so exceeding it
 * only fails once deployed.
 */
export const workersPbkdf2IterationLimit = 100_000;

/** Hashes share link passwords at the Workers PBKDF2 cap. */
export const CloudflareSecretHasherLive = secretHasherLayer(workersPbkdf2IterationLimit);
