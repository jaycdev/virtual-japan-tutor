// Compares the app's version with the server's (ADR-0012 follow-up, issue #117).
//
// Only release builds are compared: a dev build ("dev.142+1cfdacb") or a local build ("unknown")
// never warns. A release pair warns when major.minor differ; patch-level and rc differences are
// expected between releases and stay quiet.

const RELEASE = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.\d+)?$/;

/** "1.2.3" or "1.2.3-rc.1" to "1.2"; anything else (dev, unknown, missing) gives null. */
export function releaseLine(version: string | null | undefined): string | null {
  const match = version ? RELEASE.exec(version) : null;
  return match ? `${match[1]}.${match[2]}` : null;
}

/**
 * A warning for the Learner when both versions are releases and their major.minor
 * differ, else null. The sentence itself lives in the string table (issue #125);
 * this names the two versions it fills in.
 */
export function versionMismatchNotice(
  appVersion: string,
  serverVersion: string | null | undefined,
): { app: string; server: string } | null {
  const app = releaseLine(appVersion);
  const server = releaseLine(serverVersion);
  if (!app || !server || app === server) return null;
  return { app: appVersion, server: serverVersion ?? server };
}
