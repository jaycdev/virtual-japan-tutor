// The first-run flag (#50) lives in @vjt/core, shared with the web app: the rule
// (which key, what counts as seen, when the landing gate decides) is written once
// there. This file only adapts the Android secure store to core's KeyValueStore,
// so the flag keeps its key (vjt.setupSeen) and existing installs never see
// setup again.

import {
  decideLandingSetup as decideWithStore,
  hasSetupSeen as hasSeenIn,
  markSetupSeen as markSeenIn,
  type KeyValueStore,
} from "@vjt/core";
import type { ApiClient } from "@vjt/api-client";

import { appSecureStore } from "./secureStore.ts";

const setupStore: KeyValueStore = {
  getItem: (key) => appSecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    await appSecureStore.setItemAsync(key, value);
  },
};

export function hasSetupSeen(): Promise<boolean> {
  return hasSeenIn(setupStore);
}

export function markSetupSeen(): Promise<void> {
  return markSeenIn(setupStore);
}

/** The landing gate: `show-setup` sends the Learner to /setup, `stay` does nothing. */
export function decideLandingSetup(client: ApiClient) {
  return decideWithStore(client, setupStore);
}
