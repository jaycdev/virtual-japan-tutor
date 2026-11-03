// jsdom stand-in for expo-secure-store: a plain in-memory store. The storage
// adapters are tested against an explicit fake, and `Root` takes them as props.
const store = new Map<string, string>();
export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}
export async function isAvailableAsync(): Promise<boolean> {
  return false;
}
