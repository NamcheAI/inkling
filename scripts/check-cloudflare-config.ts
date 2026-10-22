#!/usr/bin/env node

// Verifies that every Cloudflare Wrangler configuration in the repository agrees on the parts
// the runtime depends on. A deployment that drifts from the runtime's Durable Object classes or
// migrations fails to deploy or, worse, deletes a class; narrower asset routing lets the static
// frontend answer requests the Worker must handle.

import { isDeepStrictEqual } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const reference = "packages/runtime-cloudflare/wrangler.jsonc";
const template = "templates/cloudflare";

interface WranglerConfig {
  readonly compatibility_date?: unknown;
  readonly durable_objects?: unknown;
  readonly migrations?: unknown;
  readonly r2_buckets?: readonly { readonly binding?: unknown }[];
  readonly assets?: {
    readonly binding?: unknown;
    readonly not_found_handling?: unknown;
    readonly run_worker_first?: unknown;
  };
}

/** Removes comments and trailing commas from JSONC without touching string contents. */
function stripJsonc(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < source.length && source[index] !== '"') {
        index += source[index] === "\\" ? 2 : 1;
      }
      index += 1;
      output += source.slice(start, index);
    } else if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      output += character;
      index += 1;
    }
  }
  return output.replaceAll(/,(\s*[}\]])/gu, "$1");
}

async function readConfig(relativePath: string): Promise<WranglerConfig> {
  const source = await readFile(path.join(root, relativePath), "utf8");
  return JSON.parse(stripJsonc(source)) as WranglerConfig;
}

function runtimeContract(config: WranglerConfig): Record<string, unknown> {
  return {
    "assets.binding": config.assets?.binding,
    "assets.not_found_handling": config.assets?.not_found_handling,
    "assets.run_worker_first": config.assets?.run_worker_first,
    compatibility_date: config.compatibility_date,
    durable_objects: config.durable_objects,
    migrations: config.migrations,
    "r2_buckets[].binding": config.r2_buckets?.map((bucket) => bucket.binding),
  };
}

async function deploymentDirectories(): Promise<string[]> {
  const entries = await readdir(path.join(root, "deployments"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.posix.join("deployments", entry.name))
    .toSorted();
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const expected = runtimeContract(await readConfig(reference));
  const deployments = await deploymentDirectories();

  const directories = [template, ...deployments];
  const configs = await Promise.all(
    directories.map((directory) => readConfig(path.posix.join(directory, "wrangler.jsonc"))),
  );
  for (const [index, config] of configs.entries()) {
    const configPath = path.posix.join(directories[index] ?? "", "wrangler.jsonc");
    const actual = runtimeContract(config);
    for (const [key, value] of Object.entries(expected)) {
      if (!isDeepStrictEqual(actual[key], value)) {
        problems.push(
          `${configPath}: ${key} is ${JSON.stringify(actual[key])}, but ${reference} has ${JSON.stringify(value)}.`,
        );
      }
    }
  }

  const [templateWorker, ...workers] = await Promise.all(
    [template, ...deployments].map((directory) =>
      readFile(path.join(root, directory, "src/worker.ts"), "utf8"),
    ),
  );
  for (const [index, worker] of workers.entries()) {
    if (worker !== templateWorker) {
      problems.push(`${deployments[index]}/src/worker.ts differs from ${template}/src/worker.ts.`);
    }
  }

  if (problems.length > 0) {
    console.error("Cloudflare configurations are out of sync:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  }
}

await main();
