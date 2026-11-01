import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Screens are tested through react-native-web: vitest has no React Native host, so
// `react-native` is aliased to its DOM implementation and the components render in
// jsdom for @testing-library/react. The app code itself never imports react-native-web.
export default defineConfig({
  resolve: {
    alias: {
      "react-native": "react-native-web",
      // The real package ships its native-module sources under the react-native
      // export condition; jsdom gets inert zero insets instead.
      "react-native-safe-area-context": fileURLToPath(new URL("./test/safe-area-stub.tsx", import.meta.url)),
      // The Expo runtime needs the native host (HMR bridge, TurboModules).
      "expo-status-bar": fileURLToPath(new URL("./test/expo-status-bar-stub.tsx", import.meta.url)),
      "expo-secure-store": fileURLToPath(new URL("./test/expo-secure-store-stub.ts", import.meta.url)),
      // react-native-svg binds to the native drawing host; jsdom gets inert views.
      "react-native-svg": fileURLToPath(new URL("./test/react-native-svg-stub.tsx", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true, // lets @testing-library/react register its automatic cleanup
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "App.test.tsx"],
  },
});
