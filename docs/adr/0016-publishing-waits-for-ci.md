# Publishing runs CI first and only goes ahead if it passes on the same commit

`publish.yml` calls `ci.yml` as a reusable workflow, and the server images and the Android APK are published only if it passes on the commit being published. A push to `main` publishes `:dev`, `:sha-<commit>` and the rolling `dev` APK. A `vX.Y.Z` tag runs CI again on the tagged commit, and the commit also has to be on `main`. We chose this because publishing used to start at the same moment as CI and never looked at its result. A failing test still produced a new `:dev` image, and a tag could publish `:latest` from a commit CI had never run on.

## Considered Options

- **`workflow_run` on CI.** Rejected. It runs against the tip of `main`, not the commit CI checked, and it never fires for tags, because CI doesn't run on tags.
- **Put the publish jobs in `ci.yml`.** Rejected. The pull request checks would share a file with the release permissions (`packages: write`, `contents: write`), and the publish jobs would show as skipped on every pull request.
- **Look up the earlier CI result for a tag's commit instead of running CI again.** Rejected. It needs extra API code, and it can't cope with a commit whose CI was cancelled or never ran. Running CI again costs a few minutes per release.
- **Only a ruleset on `main`, with no gate on publishing.** Rejected. It doesn't cover an admin bypass, two pull requests that are green alone but red together (a personal repository has no merge queue), or tags.

## Consequences

- Any red CI job blocks every publish: both images and the APK, on `main` and on tags.
- A tag runs the whole of CI again, then a `guard` job fails it if the tagged commit isn't on `main`. Cut releases from a commit that has been merged.
- CI builds the unsigned APK on pull requests only. On `main` and tags the signed build in `publish.yml` is the Android build, so a broken native build fails the APK job without blocking the images. A failed build produces no APK, so nothing bad ships.
- Runs for the same ref go one at a time, are never cancelled, and wait in a queue (`queue: max`). Every `main` commit gets a CI result, and an older commit can't overwrite a newer `:dev`. A merge waits for the previous merge's run to finish.
- A ruleset on `main` requires a pull request and the four CI checks. It doesn't require an up-to-date branch, and the repository admin can bypass it on a pull request. Two pull requests that are green alone can still turn `main` red together. The publish gate stops that commit from being published.
- If publishing partly fails on a tag (the image is up and the APK failed, or the other way round), re-run the failed job. There is no all-or-nothing release.
