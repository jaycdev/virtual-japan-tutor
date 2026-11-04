import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin, ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";

import { themeBootstrapScript } from "./src/theme/bootstrap.ts";
import { repoPath, retryReporter } from "./src/test/retryReporter.ts";
import { API_PREFIXES } from "./api-prefixes.ts";

// The Go server mounts the API at the root of its origin (api/openapi.yaml) and
// also serves this build from the same origin. In development Vite proxies those
// API prefixes to the server, so login is same-origin here too. VJT_API_ORIGIN
// points the proxy at another host (for example a server running on a remote
// Docker VM); it defaults to the local dev server on :8080.
const API_ORIGIN = process.env.VJT_API_ORIGIN ?? "http://localhost:8080";

// A browser page load is for the app, not the API, even on a path that is also an
// API prefix ("/stories/12" reloaded). The Go server makes the same call
// (internal/webui): a navigation asks for text/html and gets the app shell.
const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  API_PREFIXES.map((prefix) => [
    `/${prefix}`,
    {
      target: API_ORIGIN,
      changeOrigin: true,
      bypass(req) {
        return req.method === "GET" && req.headers.accept?.includes("text/html") ? "/index.html" : undefined;
      },
    },
  ]),
);

/** Injects the no-flash theme script into index.html (see src/theme/bootstrap.ts). */
function themeBootstrap(): Plugin {
  return {
    name: "vjt-theme-bootstrap",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replace("<!--THEME_BOOTSTRAP-->", () => `<script>${themeBootstrapScript()}</script>`),
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), themeBootstrap()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // React, the router and the Radix/lucide base get one long-cached chunk
    // instead of riding in whichever route first pulls them in.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "vendor-react", test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 20 }],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    proxy,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // A findBy/waitFor can wait up to 5 s (src/test/setup.ts); the test budget
    // must outlast that or a timed-out wait cannot report its own error.
    testTimeout: 15_000,
    retry: process.env.CI ? 1 : 0,
    reporters: process.env.CI
      ? [
          "default",
          ["github-actions", { onWritePath: repoPath }],
          retryReporter({ githubActions: process.env.GITHUB_ACTIONS === "true" }),
        ]
      : ["default"],
  },
});
