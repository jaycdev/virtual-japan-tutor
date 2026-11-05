// Builds the release APK for the variant in APP_VARIANT (ADR-0012). Run from apps/mobile:
//   pnpm --filter @vjt/mobile build:apk
// Generates android/ with Expo, then runs Gradle's assembleRelease. The output is an APK signed
// with the keystore in the environment, or with Expo's debug key when no signing variables are set.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const androidDir = join(root, "android");
const packageJsonPath = join(root, "package.json");
const isWindows = process.platform === "win32";

function run(command, args, cwd) {
  // shell: true lets Windows find expo.cmd and gradlew.bat.
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: isWindows });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status ?? "signal " + result.signal})`);
  }
}

function build() {
  run("expo", ["prebuild", "--platform", "android", "--clean", "--no-install"], root);
  // cmd.exe does not search the working directory, so the Windows wrapper needs an explicit .\ path.
  run(isWindows ? ".\\gradlew.bat" : "./gradlew", ["assembleRelease"], androidDir);

  const apk = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!existsSync(apk)) throw new Error(`Expected APK not found at ${apk}`);
  console.log(`APK built: ${apk}`);
}

// prebuild rewrites package.json (the "android" script and "main"). Keep the committed file as it is.
const packageJsonBefore = readFileSync(packageJsonPath, "utf8");
try {
  build();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  writeFileSync(packageJsonPath, packageJsonBefore);
}
