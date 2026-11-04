// Native half of the platform split (#51 review B1): an Android device has
// no same-origin fallback, so a build with no saved address points at
// 10.0.2.2 — the host machine as seen from the Android emulator. Metro picks
// this file for the Android bundle; web gets platformDefault.ts instead.
export function platformApiDefault(): string {
  return "http://10.0.2.2:8080";
}
