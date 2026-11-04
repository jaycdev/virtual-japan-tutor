// Writes web.css and native.css from src/tokens.ts. Run by `pnpm generate`
// (turbo) and checked for staleness by scripts/check-generated.mjs in CI.
// Plain Node type stripping runs this file directly, so keep it to erasable
// TypeScript syntax.
import { writeFileSync } from "node:fs";
import { renderNativeCss, renderWebCss } from "../src/render.ts";

const root = new URL("../", import.meta.url);
writeFileSync(new URL("web.css", root), renderWebCss());
writeFileSync(new URL("native.css", root), renderNativeCss());
console.log("packages/design: wrote web.css and native.css");
