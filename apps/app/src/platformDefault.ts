// Web half of the platform split (#51 review B1): the Go server that serves
// this bundle also hosts the API (apps/server/internal/webui), so with no
// saved address the API is the page's own origin — the same behaviour the
// pre-#51 Vite client had. Metro picks platformDefault.native.ts for the
// Android bundle instead (same mechanism as src/secureStore), so the
// emulator address never reaches the web bundle.
export function platformApiDefault(): string {
  return window.location.origin;
}
