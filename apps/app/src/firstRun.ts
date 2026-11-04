// One-time first-run setup (#50). The flag lives in the app's secure store
// (SecureStore on Android, localStorage on web) and is written when the
// setup flow is SHOWN — not when it is finished — so skipping the whole
// flow or walking out halfway still counts as seen. The landing gate also
// writes it without showing the flow when GET /starting-level reports the
// account is already configured (review B2: upgraders, second Learners on
// this device and reinstalls are not nagged). Logout deliberately leaves
// it alone: setup is once per device-and-account, not once per login.
//
// The specifier stays extensionless so Metro picks secureStore.native.ts on
// Android (see the comment in secureStore.ts).

import { appSecureStore } from "./secureStore";

const SETUP_SEEN_KEY = "vjt.setupSeen";

export async function hasSetupSeen(): Promise<boolean> {
  return (await appSecureStore.getItemAsync(SETUP_SEEN_KEY)) === "yes";
}

export async function markSetupSeen(): Promise<void> {
  await appSecureStore.setItemAsync(SETUP_SEEN_KEY, "yes");
}
