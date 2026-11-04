import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept in step with the window. The reader
 * uses it to pick a centred Dialog or a bottom Sheet (ui-plan 4.1: a Sheet below
 * a 640 px viewport). Without matchMedia (very old browsers, some test hosts)
 * it answers false, which gives the desktop Dialog.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}
