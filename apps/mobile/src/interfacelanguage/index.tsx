// Bridges the device's stored Interface Language into @vjt/core's
// InterfaceLanguageProvider (issue #125). The Gate sits above the auth gate in
// App.tsx, so the login card, the server-address screen and the first-run
// wizard all speak the saved language too — and switching is a state change,
// never a reload or refetch.

import { useEffect, useSyncExternalStore } from "react";
import { InterfaceLanguageProvider, type InterfaceLanguage } from "@vjt/core";

import { interfaceLanguageStorage } from "./storage.ts";
import { createInterfaceLanguageStore, type InterfaceLanguageState } from "./store.ts";

// Module-scope singleton, mirroring the theme and Story-text-size stores: one
// setting for the whole app, one secure-store key.
export const interfaceLanguageStore = createInterfaceLanguageStore(interfaceLanguageStorage);

// Stable snapshot for useSyncExternalStore's server path; a fresh object per
// call would break the equality check React relies on.
const SERVER_SNAPSHOT: InterfaceLanguageState = { language: "en" };

/**
 * Hydrates the saved choice at app start and re-renders when it changes.
 * Unlike the ThemeProvider this never gates the first frame: a frame that
 * opens in English and corrects itself is one repaint of the chrome, and the
 * login card must not wait on a storage read to appear.
 */
export function InterfaceLanguageGate({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(
    interfaceLanguageStore.subscribe,
    interfaceLanguageStore.getSnapshot,
    () => SERVER_SNAPSHOT,
  );

  useEffect(() => {
    void interfaceLanguageStore.hydrate();
  }, []);

  return (
    <InterfaceLanguageProvider language={state.language} setLanguage={interfaceLanguageStore.setLanguage}>
      {children}
    </InterfaceLanguageProvider>
  );
}

export interface InterfaceLanguageChoice {
  language: InterfaceLanguage;
  setLanguage: (language: InterfaceLanguage) => void;
}

/** The stored choice and the setter, for the Appearance and login pickers. */
export function useInterfaceLanguageChoice(): InterfaceLanguageChoice {
  const state = useSyncExternalStore(
    interfaceLanguageStore.subscribe,
    interfaceLanguageStore.getSnapshot,
    () => SERVER_SNAPSHOT,
  );
  return { language: state.language, setLanguage: interfaceLanguageStore.setLanguage };
}
