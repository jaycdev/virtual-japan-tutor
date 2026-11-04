// Fails (exit 1) if any generated file is modified OR untracked relative to git.
// Run after `pnpm generate:force`. Optional args override the default paths (used by tests).
import { execFileSync } from "node:child_process";

const DEFAULT_PATHS = [
  "apps/server/internal/api",
  "packages/api-client/src/generated",
  "packages/design/web.css",
  "packages/design/native.css",
];
const paths = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PATHS;

// --porcelain lists modified, staged, deleted and untracked entries; --untracked-files=all
// lists individual new files instead of collapsing a new directory.
const out = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all", "--", ...paths],
  { encoding: "utf8" },
).trim();

if (out) {
  console.error(
    `Generated code is stale. Run \`pnpm generate\` and commit the result:\n${out}`,
  );
  process.exit(1);
}
console.log("Generated code is up to date.");
