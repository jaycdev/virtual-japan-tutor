// One-time first-run setup (#50), shared by web and mobile. The flag is written
// when the setup flow is SHOWN, not when it is finished, so skipping the whole
// flow or leaving halfway still counts as seen. The landing gate also writes it
// without showing the flow when GET /starting-level reports the account is
// already configured (upgraders, a second Learner on this device, a reinstall).
// Logout deliberately leaves the flag alone: setup is once per device-and-account.
//
// Each app supplies its own key-value store (localStorage on web, the secure
// store on Android), so this module stays free of platform code.

import type { ApiClient } from "@vjt/api-client";

/** Where the flag lives on this device. Same shape as the theme stores. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const SETUP_SEEN_KEY = "vjt.setupSeen";

export async function hasSetupSeen(store: KeyValueStore): Promise<boolean> {
  return (await store.getItem(SETUP_SEEN_KEY)) === "yes";
}

export async function markSetupSeen(store: KeyValueStore): Promise<void> {
  await store.setItem(SETUP_SEEN_KEY, "yes");
}

/**
 * `show-setup`: send the Learner to the first-run setup route, which marks the
 * flag itself as it is shown. `stay`: do nothing (already seen, already
 * configured — marked here — or the server did not answer; an inconclusive
 * answer is decided again on the next visit).
 */
export type LandingSetupDecision = "show-setup" | "stay";

/**
 * The landing gate (issue #50, review B2): a signed-in Learner who has never seen
 * the setup flow is sent to it only when the account has no Starting Level yet.
 * `client` must already authenticate.
 */
export async function decideLandingSetup(
  client: ApiClient,
  store: KeyValueStore,
): Promise<LandingSetupDecision> {
  if (await hasSetupSeen(store)) return "stay";
  let configured: boolean | undefined;
  try {
    // openapi-fetch resolves HTTP errors instead of throwing, so an error
    // response leaves `data` undefined: the inconclusive case below.
    configured = (await client.GET("/starting-level")).data?.configured;
  } catch {
    return "stay";
  }
  if (configured === undefined) return "stay";
  if (configured) {
    await markSetupSeen(store); // known account: never ask again
    return "stay";
  }
  return "show-setup";
}
