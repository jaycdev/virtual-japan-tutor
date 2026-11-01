// 10.0.2.2 is the host machine as seen from the Android emulator.
const DEFAULT_API_URL = "http://10.0.2.2:8080";

export function resolveApiBaseUrl(env: { EXPO_PUBLIC_API_URL?: string | undefined }): string {
  const url = env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;
  return url.replace(/\/+$/, "");
}
