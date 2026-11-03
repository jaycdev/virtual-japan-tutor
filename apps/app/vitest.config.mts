import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { transformWithOxc } from "vite";

// @rn-primitives/* ship raw JSX inside their .mjs ESM bundles (Metro transforms
// node_modules with Babel, Node's ESM loader does not). Pull them through
// vite's transform pipeline with the jsx loader instead of leaving them external.
const rnPrimitivesJsx = {
  name: "rn-primitives-jsx",
  transform(code: string, id: string) {
    const clean = id.split("?")[0];
    if (!/[\\/]@rn-primitives[\\/]/.test(clean) || !/\.m?js$/.test(clean)) return null;
    return transformWithOxc(code, clean, { lang: "jsx", jsx: { runtime: "automatic" } });
  },
};

// Screens are tested through react-native-web: vitest has no React Native host, so
// `react-native` is aliased to its DOM implementation and the components render in
// jsdom for @testing-library/react. The app code itself never imports react-native-web.
export default defineConfig({
  plugins: [rnPrimitivesJsx],
  resolve: {
    alias: {
      "react-native": "react-native-web",
      // The real package ships its native-module sources under the react-native
      // export condition; jsdom gets inert zero insets instead.
      "react-native-safe-area-context": fileURLToPath(new URL("./test/safe-area-stub.tsx", import.meta.url)),
      // The Expo runtime needs the native host (HMR bridge, TurboModules).
      "expo-status-bar": fileURLToPath(new URL("./test/expo-status-bar-stub.tsx", import.meta.url)),
      "expo-secure-store": fileURLToPath(new URL("./test/expo-secure-store-stub.ts", import.meta.url)),
      // expo-font needs the native module host too.
      "expo-font": fileURLToPath(new URL("./test/expo-font-stub.ts", import.meta.url)),
      // react-native-svg binds to the native drawing host; jsdom gets inert views.
      "react-native-svg": fileURLToPath(new URL("./test/react-native-svg-stub.tsx", import.meta.url)),
      // --- #42 spike additions (Uniwind + React Native Reusables) ---
      // The repo-root alias that components.json / tsconfig paths give the app.
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Uniwind's className compiler lives in Metro; jsdom ignores className.
      "uniwind": fileURLToPath(new URL("./test/uniwind-stub.ts", import.meta.url)),
      // Reanimated 4 needs its Babel plugin and worklet host.
      "react-native-reanimated": fileURLToPath(new URL("./test/reanimated-stub.tsx", import.meta.url)),
      // react-native-screens needs the native navigation host.
      "react-native-screens": fileURLToPath(new URL("./test/react-native-screens-stub.tsx", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true, // lets @testing-library/react register its automatic cleanup
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "showcase/**/*.test.{ts,tsx}", "App.test.tsx"],
    server: {
      deps: {
        // must go through vite so the raw-JSX .mjs files above get compiled,
        // and so lucide's `react-native` / `react-native-svg` imports hit the
        // aliases above instead of Node loading the real native packages
        inline: [/@rn-primitives\//, /lucide-react-native/],
      },
    },
  },
});
