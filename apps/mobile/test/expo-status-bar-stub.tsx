// jsdom stand-ins for the Expo native modules App.tsx wires in production.
// Tests exercise `Root` with injected fakes; the default `App` export only needs
// these to import cleanly.

export function StatusBar() {
  return null;
}
