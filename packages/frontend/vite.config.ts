import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { elanorAssets } from "./scripts/elanor-assets.ts";

export default defineConfig({
  plugins: [react(), elanorAssets()],
  build: {
    target: "es2023",
  },
  server: {
    port: 5173,
    proxy: {
      "/AGENTS.md": {
        changeOrigin: false,
        target: "http://localhost:8787",
      },
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
});
