// Expo inlines EXPO_PUBLIC_* at bundle time; declare just enough for type-checking.
declare const process: { env: { EXPO_PUBLIC_API_URL?: string; EXPO_PUBLIC_SHOWCASE?: string } };

// global.css is imported for Uniwind (the showcase and, later, the screens).
declare module "*.css";

// The app bundle never touches Node's fs; two tests do, in Node under
// vitest: the storysize parity test reads global.css off disk, and the
// accessibility-role guard walks src/ and app/. Declare just what those
// tests call — same spirit as `process` above.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
declare const __dirname: string;
