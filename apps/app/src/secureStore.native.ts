import * as SecureStore from "expo-secure-store";

import type { SecureStoreLike } from "./tokenStorage.ts";

// The Android keystore-backed store (see secureStore.ts for the web split).
export const appSecureStore: SecureStoreLike = SecureStore;
