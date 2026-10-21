// Builds the Elanor design system from the pinned `vendor/elanor-src` submodule and writes the packages Inkling
// consumes to `vendor/elanor/`, where they are pnpm workspace packages. The build output is not committed; run this
// after cloning or bumping the submodule, before `pnpm install`. `make setup` does both.
//
// Why not add the submodule's packages to the workspace directly: Elanor is a pnpm monorepo whose packages only become
// usable after its own toolchain (pinned pnpm, lockfile, and supply-chain policy) generates token CSS (Terrazzo), icon
// components (from SVG sources), and React components with precompiled styles. Building it in isolation keeps Elanor's
// development dependencies out of Inkling's lockfile.
//
// Usage:
//   git submodule update --init vendor/elanor-src
//   node scripts/build-elanor.mjs [--force]
//   pnpm install
//
// The build is skipped when `vendor/elanor/SOURCE.json` already records the submodule commit, the requested icons, and
// this script's version. The icon package ships ~4k Material Symbols (37 MB unpacked); only icons Elanor's React
// components import plus those listed in `vendor/elanor/icons.json` are kept. Add an icon's export name there and
// rerun to make it available.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "vendor/elanor-src");
const output = join(root, "vendor/elanor");
const extraIconsFile = join(output, "icons.json");

// Packages Inkling consumes, by their directory in the Elanor workspace and their directory under `vendor/elanor/`.
const PACKAGES = [
  { workspace: "packages/fonts", vendored: "elanor-fonts" },
  { workspace: "packages/icons/plain/react", vendored: "elanor-icons-react" },
  { workspace: "packages/design-tokens", vendored: "design-tokens" },
  { workspace: "packages/react", vendored: "elanor-react" },
];
// Token brands Inkling uses.
const TOKEN_BRANDS = ["earendil"];
// Fields of a packed package.json that matter to consumers. Scripts and devDependencies refer to Elanor's workspace
// and toolchain; pnpm would try to install and run them as workspace members.
const PACKAGE_FIELDS = [
  "name",
  "version",
  "description",
  "license",
  "private",
  "type",
  "sideEffects",
  "exports",
  "dependencies",
  "peerDependencies",
];

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
}

function capture(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
}

if (!existsSync(join(source, "package.json"))) {
  throw new Error(
    "vendor/elanor-src is missing; run `git submodule update --init vendor/elanor-src`",
  );
}
const commit = capture("git", ["rev-parse", "HEAD"], source);
const requestedIcons = existsSync(extraIconsFile) ? readFileSync(extraIconsFile, "utf8") : "[]";
const fingerprint = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .update(requestedIcons)
  .digest("hex");
const sourceFile = join(output, "SOURCE.json");
if (!process.argv.includes("--force") && isCurrent()) {
  console.log(`Elanor ${commit.slice(0, 12)} is already built in ${relative(root, output)}.`);
  process.exit(0);
}
if (capture("git", ["status", "--porcelain"], source) !== "") {
  console.warn("vendor/elanor-src has local changes; building its committed HEAD only.");
}

const work = mkdtempSync(join(tmpdir(), "elanor-"));
try {
  // Build from an exported tree so the submodule never gets node_modules or build output.
  const tree = join(work, "src");
  mkdirSync(tree);
  execFileSync("sh", ["-c", `git -C "${source}" archive --format=tar HEAD | tar -x -C "${tree}"`]);

  // Elanor's lockfile and supply-chain policy apply. pnpm switches to the version Elanor pins in `packageManager`.
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], tree);
  run("pnpm", ["--filter", "@earendil-works/elanor-icons", "run", "build"], tree);
  run("pnpm", ["--filter", "@earendil-works/elanor-icons-react", "run", "build"], tree);
  for (const brand of TOKEN_BRANDS) {
    run("pnpm", ["--filter", "@earendil-works/design-tokens", "run", `build:${brand}`], tree);
  }
  run("pnpm", ["--filter", "@earendil-works/elanor-react", "run", "build"], tree);

  // `pnpm pack` produces what a registry install would: published files only, `workspace:` versions resolved.
  const packs = join(work, "packs");
  const staged = join(work, "staged");
  mkdirSync(packs);
  mkdirSync(staged);
  const names = new Set();
  for (const pkg of PACKAGES) {
    const before = new Set(readdirSync(packs));
    run("pnpm", ["pack", "--pack-destination", packs], join(tree, pkg.workspace));
    const tarball = readdirSync(packs).find((name) => !before.has(name));
    if (!tarball) {
      throw new Error(`pnpm pack produced no tarball for ${pkg.workspace}`);
    }
    const target = join(staged, pkg.vendored);
    mkdirSync(target);
    run("tar", ["-xzf", join(packs, tarball), "-C", target, "--strip-components=1"]);
    names.add(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).name);
  }

  for (const pkg of PACKAGES) {
    const target = join(staged, pkg.vendored);
    const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    const cleaned = {};
    for (const field of PACKAGE_FIELDS) {
      if (manifest[field] !== undefined) {
        cleaned[field] = manifest[field];
      }
    }
    // Vendored packages depend on each other through the workspace, not the registry.
    for (const name of Object.keys(cleaned.dependencies ?? {})) {
      if (names.has(name)) {
        cleaned.dependencies[name] = "workspace:*";
      }
    }
    writeFileSync(join(target, "package.json"), `${JSON.stringify(cleaned, null, 2)}\n`);
  }

  // Design tokens: keep each brand's CSS and catalogue; drop the Figma exports and the other brands' exports.
  for (const brand of readdirSync(join(staged, "design-tokens/dist"))) {
    const directory = join(staged, "design-tokens/dist", brand);
    if (!TOKEN_BRANDS.includes(brand)) {
      rmSync(directory, { recursive: true });
      continue;
    }
    for (const file of readdirSync(directory)) {
      if (file.endsWith(".figma.json")) {
        rmSync(join(directory, file));
      }
    }
  }
  const tokensManifestPath = join(staged, "design-tokens/package.json");
  const tokensManifest = JSON.parse(readFileSync(tokensManifestPath, "utf8"));
  tokensManifest.exports = Object.fromEntries(
    Object.entries(tokensManifest.exports).filter(
      ([name]) => !name.endsWith(".css") || TOKEN_BRANDS.includes(name.slice(2, -4)),
    ),
  );
  writeFileSync(tokensManifestPath, `${JSON.stringify(tokensManifest, null, 2)}\n`);

  const icons = pruneIcons(
    join(staged, "elanor-icons-react/dist"),
    join(staged, "elanor-react/dist"),
  );

  for (const pkg of PACKAGES) {
    const target = join(output, pkg.vendored);
    // Keep the dependency links `pnpm install` created, so a rebuild needs no reinstall.
    const modules = join(target, "node_modules");
    if (existsSync(modules)) renameSync(modules, join(staged, pkg.vendored, "node_modules"));
    rmSync(target, { recursive: true, force: true });
    cpSync(join(staged, pkg.vendored), target, { recursive: true, verbatimSymlinks: true });
  }
  writeFileSync(
    sourceFile,
    `${JSON.stringify(
      {
        repository: "git@github.com:earendil-works/elanor.git",
        commit,
        fingerprint,
        packages: Object.fromEntries(PACKAGES.map((pkg) => [pkg.vendored, pkg.workspace])),
        tokenBrands: TOKEN_BRANDS,
        icons,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Built Elanor ${commit} into ${relative(root, output)} (${icons.length} icons).`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** Whether the build output matches the submodule commit, the requested icons, and this script. */
function isCurrent() {
  if (!existsSync(sourceFile)) return false;
  if (!PACKAGES.every((pkg) => existsSync(join(output, pkg.vendored, "package.json"))))
    return false;
  try {
    const recorded = JSON.parse(readFileSync(sourceFile, "utf8"));
    return recorded.commit === commit && recorded.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

/**
 * Keeps the icons Elanor's own components import plus the extras Inkling lists, rewriting the barrel files to match.
 * Returns the kept export names.
 */
function pruneIcons(iconsDist, reactDist) {
  const exportLine = /^export \{(\w+)\} from "\.\/([\w-]+)\.js";$/;
  const files = new Map();
  for (const line of readFileSync(join(iconsDist, "index.js"), "utf8").split("\n")) {
    const match = exportLine.exec(line);
    if (match) {
      files.set(match[1], match[2]);
    }
  }

  const wanted = new Set(
    existsSync(extraIconsFile) ? JSON.parse(readFileSync(extraIconsFile, "utf8")) : [],
  );
  const importLine = /import\s*\{([^}]*)\}\s*from\s*['"]@earendil-works\/elanor-icons-react['"]/g;
  for (const file of walk(reactDist)) {
    if (!file.endsWith(".js")) {
      continue;
    }
    for (const match of readFileSync(file, "utf8").matchAll(importLine)) {
      for (const name of match[1].split(",")) {
        if (name.trim()) {
          wanted.add(name.trim().split(/\s+as\s+/)[0]);
        }
      }
    }
  }

  const kept = [...wanted].toSorted();
  const keepFiles = new Set(["index", "create-icon"]);
  for (const name of kept) {
    const file = files.get(name);
    if (!file) {
      throw new Error(`Unknown Elanor icon ${name}`);
    }
    keepFiles.add(file);
  }
  for (const entry of readdirSync(iconsDist)) {
    const base = entry.replace(/\.(d\.ts|js)$/, "");
    if ((entry.endsWith(".js") || entry.endsWith(".d.ts")) && !keepFiles.has(base)) {
      rmSync(join(iconsDist, entry));
    }
  }
  const barrel = kept.map((name) => `export {${name}} from "./${files.get(name)}.js";\n`).join("");
  writeFileSync(join(iconsDist, "index.js"), barrel);
  writeFileSync(join(iconsDist, "index.d.ts"), barrel);
  return kept;
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}
