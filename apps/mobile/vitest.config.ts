import { defineConfig } from "vitest/config";

// Screens are tested through react-native-web: vitest has no React Native host, so
// `react-native` is aliased to its DOM implementation and the components render in
// jsdom for @testing-library/react. The app code itself never imports react-native-web.
export default defineConfig({
  resolve: { alias: { "react-native": "react-native-web" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "App.test.tsx"],
  },
});
