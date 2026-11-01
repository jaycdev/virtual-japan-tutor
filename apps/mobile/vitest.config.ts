import { defineConfig } from "vitest/config";

// Only plain-TS logic is unit-tested here; React Native components are not run under vitest.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
