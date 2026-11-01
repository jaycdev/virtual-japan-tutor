/**
 * Where the session token lives between launches. Web uses localStorage, mobile uses
 * expo-secure-store; each app supplies its own adapter. Async so both fit.
 */
export interface TokenStorage {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory storage: for tests and as a reference implementation. */
export function memoryTokenStorage(initial: string | null = null): TokenStorage {
  let token = initial;
  return {
    get: async () => token,
    set: async (value) => {
      token = value;
    },
    clear: async () => {
      token = null;
    },
  };
}
