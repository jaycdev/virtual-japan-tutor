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
      "expo-secure-store": fileURLToPath(new URL("./test/cjs-stubs/expo-secure-store.cjs", import.meta.url)),
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
      // --- #44: expo-router boots under jsdom; expo-modules-core needs the native host.
      "expo-modules-core": fileURLToPath(new URL("./test/cjs-stubs/expo-modules-core.cjs", import.meta.url)),
      // --- #45: the reader's Lookup menu and windows use Popover/Dialog. Expo picks the
      // primitives' .web build per platform and jsdom is "web", so tests follow web —
      // the native build gates its Portal on measure(), which jsdom does not implement:
      // aliased to native, Popover/Dialog content never renders and the menu/window
      // tests would pass (or fail) for the wrong reason. Expo really does resolve the
      // web files: the primitives resolve the same way, by platform extension.
      "@rn-primitives/popover": fileURLToPath(new URL("../../node_modules/@rn-primitives/popover/dist/popover.web.mjs", import.meta.url)),
      "@rn-primitives/dialog": fileURLToPath(new URL("../../node_modules/@rn-primitives/dialog/dist/dialog.web.mjs", import.meta.url)),
      // #48: the Library card's menu and the Generate dialog's pickers are
      // DropdownMenus, and jsdom follows Expo's platform choice — the web build.
      "@rn-primitives/dropdown-menu": fileURLToPath(new URL("../../node_modules/@rn-primitives/dropdown-menu/dist/dropdown-menu.web.mjs", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true, // lets @testing-library/react register its automatic cleanup
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "showcase/**/*.test.{ts,tsx}", "App.test.tsx"],
    retry: process.env.CI ? 1 : 0,
    server: {
      deps: {
        // must go through vite so the raw-JSX .mjs files above get compiled,
        // so lucide's `react-native` / `react-native-svg` imports hit the
        // aliases above instead of Node loading the real native packages,
        // and so expo-router's CJS build (and its ESM-first react-navigation
        // deps, which Node's require-of-ESM cannot reexport from) are
        // transformed instead of handed to Node's loader.
        inline: [
          /@rn-primitives\//,
          /lucide-react-native/,
          /expo-router/,
          /@react-navigation\//,
          /react-native-is-edge-to-edge/,
          // Every expo-* / @expo/* package must go through vite so the
          // `react-native` alias (react-native-web) applies to their requires;
          // through Node's loader they hit the Flow-typed native sources.
          /expo-/,
          /@expo\//,
        ],
      },
    },
  },
});
