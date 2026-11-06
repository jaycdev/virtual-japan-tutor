// Turns a release tag or a dev build into the Android versionName and versionCode (ADR-0012).
//
// Release: versionCode = major*1_000_000 + minor*10_000 + patch*100 + n, where n is the release
// candidate number, or 99 for a final release, so every rc sorts below its final release.
// Dev: versionCode is the CI run number; versionName is "dev.<run>+<short sha>" so a bug report
// points at an exact commit.
//
// The CI command line wrapper is scripts/print-android-version.mjs.

export type AndroidVersion = { versionName: string; versionCode: number };

const FINAL_RELEASE_N = 99;
const MAX_VERSION_CODE = 2_100_000_000;
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

export function versionFromReleaseTag(tag: string): AndroidVersion {
  const match = RELEASE_TAG.exec(tag);
  if (!match) {
    throw new Error(`Not a release tag: "${tag}" (expected vX.Y.Z or vX.Y.Z-rc.N)`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const rc = match[4] === undefined ? undefined : Number(match[4]);

  if (minor > 99 || patch > 99) {
    throw new Error(`Tag "${tag}": minor and patch must be 99 or less to fit versionCode`);
  }
  if (rc !== undefined && rc >= FINAL_RELEASE_N) {
    throw new Error(`Tag "${tag}": release candidate number must be ${FINAL_RELEASE_N - 1} or less`);
  }

  const n = rc ?? FINAL_RELEASE_N;
  const versionCode = major * 1_000_000 + minor * 10_000 + patch * 100 + n;
  if (versionCode > MAX_VERSION_CODE) {
    throw new Error(`Tag "${tag}": versionCode ${versionCode} exceeds Android's limit`);
  }
  return { versionName: tag.slice(1), versionCode };
}

export function versionFromDevBuild(run: number, sha: string): AndroidVersion {
  if (!Number.isInteger(run) || run < 1 || run > MAX_VERSION_CODE) {
    throw new Error(`Dev build run number must be a positive integer, got ${run}`);
  }
  if (!/^[0-9a-f]{7,40}$/.test(sha)) {
    throw new Error(`Dev build commit must be at least 7 lowercase hex characters, got "${sha}"`);
  }
  return { versionName: `dev.${run}+${sha.slice(0, 7)}`, versionCode: run };
}
