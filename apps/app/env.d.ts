// Expo inlines EXPO_PUBLIC_* at bundle time; declare just enough for type-checking.
declare const process: { env: { EXPO_PUBLIC_API_URL?: string; EXPO_PUBLIC_SHOWCASE?: string } };

// global.css is imported for Uniwind (the showcase and, later, the screens).
declare module "*.css";

// The app bundle never touches Node's fs; the storysize parity test does, to
// read global.css off disk (vitest runs the test in Node, where vite-node
// defines `__dirname` for the module). Declare just what that test calls —
// same spirit as `process` above.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare const __dirname: string;
