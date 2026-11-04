// The no-flash theme script (ADR-0010 / ui-plan 2.3). It runs as a classic
// script in <head> (index.html), before the bundle and before first paint, and
// sets the `dark` class on <html> from the saved preference, following
// prefers-color-scheme when the preference is System, including live changes.
//
// It is inlined, not imported: vite.config.ts injects it into index.html at
// build and dev time, so the key and the parsing come from one place. The logic
// is kept in a string so it runs with no module system; src/theme/bootstrap.test.ts
// evaluates the same string against a DOM. Keep it to ES5-era syntax.

import { THEME_STORAGE_KEY } from "./store.ts";

export function themeBootstrapScript(): string {
  return `(function () {
  var KEY = ${JSON.stringify(THEME_STORAGE_KEY)};
  var root = document.documentElement;
  var query = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function read() {
    var saved = null;
    try { saved = window.localStorage.getItem(KEY); } catch (e) { saved = null; }
    return saved === "light" || saved === "dark" ? saved : "system";
  }
  function apply() {
    var preference = read();
    var dark = preference === "dark" || (preference === "system" && !!(query && query.matches));
    root.classList.toggle("dark", dark);
  }
  apply();
  if (query) {
    var onSystemChange = function () { if (read() === "system") apply(); };
    if (query.addEventListener) query.addEventListener("change", onSystemChange);
    else if (query.addListener) query.addListener(onSystemChange);
  }
  window.addEventListener("storage", function (event) {
    if (event.key === null || event.key === KEY) apply();
  });
})();`;
}
