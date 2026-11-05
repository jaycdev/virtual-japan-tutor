// Prints the Android version for CI, as KEY=value lines to append to GITHUB_ENV (ADR-0012):
//   node scripts/print-android-version.mjs release v1.2.3-rc.2
//   node scripts/print-android-version.mjs dev 142 1cfdacb9f0a1
import { versionFromDevBuild, versionFromReleaseTag } from "./android-version.mts";

function main(args) {
  const [kind, ...rest] = args;
  let version;
  if (kind === "release" && rest.length === 1) {
    version = versionFromReleaseTag(rest[0]);
  } else if (kind === "dev" && rest.length === 2) {
    version = versionFromDevBuild(Number(rest[0]), rest[1]);
  } else {
    throw new Error("usage: print-android-version.mjs release <vX.Y.Z[-rc.N]> | dev <run> <sha>");
  }
  return `APP_VERSION_NAME=${version.versionName}\nAPP_VERSION_CODE=${version.versionCode}\n`;
}

try {
  process.stdout.write(main(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
