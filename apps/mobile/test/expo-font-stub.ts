// expo-font binds to the native module host (expo-modules-core). Under jsdom
// there is nothing to load: report fonts as loaded immediately.
export function useFonts(_assets: Record<string, unknown>): [boolean, null] {
  return [true, null];
}

export function loadAsync(_assets: unknown): Promise<void> {
  return Promise.resolve();
}
