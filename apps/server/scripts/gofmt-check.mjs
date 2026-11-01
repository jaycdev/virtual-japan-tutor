// Fails (exit 1) if any Go file is not gofmt-formatted. Cross-platform replacement
// for `test -z "$(gofmt -l .)"` so it works in npm scripts on Windows and Linux.
import { execFileSync } from "node:child_process";

const out = execFileSync("gofmt", ["-l", "."], { encoding: "utf8" }).trim();
if (out) {
  console.error(`These files are not gofmt-formatted (run \`gofmt -w .\`):\n${out}`);
  process.exit(1);
}
