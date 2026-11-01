// jsdom stand-in for expo-secure-store: no keystore in tests. The storage
// adapters are tested against an explicit fake, and `Root` takes them as props.
export async function getItemAsync(_key: string): Promise<string | null> {
  return null;
}
export async function setItemAsync(_key: string, _value: string): Promise<void> {}
export async function deleteItemAsync(_key: string): Promise<void> {}
export async function isAvailableAsync(): Promise<boolean> {
  return false;
}
