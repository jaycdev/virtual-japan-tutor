import * as SecureStore from "expo-secure-store";

import type { SecureStoreLike } from "./tokenStorage.ts";

// The Android keystore-backed store: the session token and the server address
// live in the device's secure store, never in plain storage.
export const appSecureStore: SecureStoreLike = SecureStore;
