import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { elanorAssets } from "./scripts/elanor-assets.ts";
import { routeAssets } from "./scripts/route-assets.ts";

// `vite build` builds the browser application into dist/; `vite build --ssr`
// builds the server renderer into dist-server/. The renderer is one
// self-contained module, React included, so any runtime can bundle or import
// it; only Inkling's own packages and Effect stay external, so the runtime
// shares its copies of them.
export default defineConfig(({ isSsrBuild = false }) => ({
  plugins: isSsrBuild ? [react(), serverContract()] : [react(), elanorAssets(), routeAssets()],
  ...(isSsrBuild ? { define: { "process.env.NODE_ENV": JSON.stringify("production") } } : {}),
  build: isSsrBuild
    ? {
        copyPublicDir: false,
        emptyOutDir: true,
        outDir: "dist-server",
        rolldownOptions: {
          external: [/^@earendil-works\/inkling-/u, /^effect(?:\/|$)/u],
          input: { server: "src/server.tsx" },
          output: { codeSplitting: false, entryFileNames: "[name].js" },
        },
        target: "es2023",
      }
    : {
        target: "es2023",
      },
  ssr: {
    noExternal: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        changeOrigin: false,
        target: "http://localhost:8787",
        ws: true,
      },
      // MCP and its OAuth discovery, registration, consent, and token endpoints.
      "/.well-known/oauth-": {
        changeOrigin: false,
        target: "http://localhost:8787",
      },
      "/mcp": {
        changeOrigin: false,
        target: "http://localhost:8787",
      },
      "/oauth/": {
        changeOrigin: false,
        target: "http://localhost:8787",
      },
      "/theme.css": {
        changeOrigin: false,
        target: "http://localhost:8787",
      },
      "/theme.json": {
        changeOrigin: false,
        target: "http://localhost:8787",
      },
    },
  },
}));

/** Publishes the renderer's contract as its declaration file. */
function serverContract(): Plugin {
  return {
    name: "inkling-server-contract",
    generateBundle() {
      this.emitFile({
        fileName: "server.d.ts",
        source: readFileSync(new URL("src/server-contract.ts", import.meta.url), "utf8"),
        type: "asset",
      });
    },
  };
}
