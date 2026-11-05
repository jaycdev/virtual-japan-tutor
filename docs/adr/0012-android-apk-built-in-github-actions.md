# Build the Android APK in GitHub Actions with Expo prebuild, not EAS

The Android app ships as a signed APK built in our own GitHub Actions: `expo prebuild` generates `android/` on the runner and Gradle builds the release. `android/` is not committed. A `vX.Y.Z` tag attaches a universal APK to that tag's GitHub Release; each push to `main` replaces the APK on a rolling `dev` pre-release. We chose this because the project is self-hosted from this repo: no Expo account, no build quota, and the whole release path is readable in `.github/workflows`.

## Considered Options

- **EAS Build.** Rejected: it needs an Expo account and token, the free tier has queues and monthly limits, and signing and part of the release would live outside the repo.
- **Commit `android/` and build it with Gradle.** Rejected: every Expo SDK upgrade would mean merging native project changes by hand, and nothing in the app needs custom native code yet.
- **Google Play.** Deferred: it needs a developer account, an AAB, a store listing and review. Sideloading from GitHub Releases (or Obtainium) is enough for self-hosters for now.

## Consequences

- One release keystore signs every build, release and dev. It lives in repo secrets and is backed up offline; losing it means every user must uninstall and reinstall.
- The dev build is a separate app (`com.jaycdev.virtualjapantutor.dev`, "VJT Dev") so it installs next to the release app. Its `versionCode` is the workflow run number and its `versionName` is `dev.<run>+<short sha>`.
- Release `versionName` comes from the tag, and `versionCode` is `major×1,000,000 + minor×10,000 + patch×100 + n`, where `n` is the rc number or 99 for a final release, so an rc always sorts below its release. `app.config.ts` does not hold the version.
- Release builds stay HTTPS-only, so the server must be behind HTTPS to use the prebuilt APK.
- Like the images, publishing does not wait for CI. Tag a green commit.
