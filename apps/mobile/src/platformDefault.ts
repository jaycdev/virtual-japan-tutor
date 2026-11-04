// The Android half of the API default (#51 review B1): a build with no saved
// address points at 10.0.2.2, the host machine as seen from the Android
// emulator. Override it through EXPO_PUBLIC_API_URL or the in-app server setting.
export function platformApiDefault(): string {
  return "http://10.0.2.2:8080";
}
