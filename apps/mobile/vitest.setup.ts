// expo-router's compiled CJS requires 'react-native' through Node's CommonJS
// loader (its internal relative requires escape vite's module runner), which
// bypasses the vite alias to react-native-web and hands Node the Flow-typed
// native sources ("Unexpected token 'typeof'"). Redirect the bare request in
// Node's resolver itself so both paths land on react-native-web.
import { resolve } from "node:path";
import nodeModule from "node:module";

// SDK 58 compiles `process.env.EXPO_OS` away at bundle time; vitest leaves it
// undefined, which sends expo-router down its native DOM-event bridge (and
// makes it require expo's private global-events module). The harness runs on
// react-native-web, so declare the web target. (env.d.ts types the app's
// `process` narrowly for bundle code; this file runs under Node.)
const nodeProcess = globalThis.process as unknown as {
  env: Record<string, string | undefined>;
  cwd(): string;
};
nodeProcess.env.EXPO_OS = "web";

type ResolverFn = (
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown,
) => string;
const NATIVE_ONLY_TO_STUB: Record<string, string> = {
  "react-native": "react-native.cjs",
  "react-native-safe-area-context": "react-native-safe-area-context.cjs",
  "react-native-screens": "react-native-screens.cjs",
  "react-native-gesture-handler": "react-native-gesture-handler.cjs",
  expo: "expo.cjs",
  "expo-glass-effect": "expo-glass-effect.cjs",
  "expo-linking": "expo-linking.cjs",
  "expo-modules-core": "expo-modules-core.cjs",
  "expo-constants": "expo-constants.cjs",
};
const stubDir = resolve(nodeProcess.cwd(), "test/cjs-stubs");
const resolver = nodeModule as unknown as { _resolveFilename: ResolverFn };
const originalResolve = resolver._resolveFilename;
resolver._resolveFilename = function (this: unknown, request, parent, isMain, options) {
  // Exact and subpath requests ("react-native-screens/experimental") both go
  // to the stub: the packages' own subpaths assume Metro-style resolution.
  let stub = NATIVE_ONLY_TO_STUB[request];
  if (!stub && typeof request === "string") {
    for (const pkg of Object.keys(NATIVE_ONLY_TO_STUB)) {
      if (request === pkg || request.startsWith(`${pkg}/`)) {
        stub = NATIVE_ONLY_TO_STUB[pkg];
        break;
      }
    }
  }
  if (stub) return resolve(stubDir, stub);
  return originalResolve.call(this, request, parent, isMain, options);
};

// expo (pulled in by App's production wiring) reads the Metro build flag.
(globalThis as Record<string, unknown>).__DEV__ = true;

// jsdom gaps that react-native-web expects at import time.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
