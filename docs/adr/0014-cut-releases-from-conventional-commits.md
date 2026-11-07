# Cut releases on demand from the conventional commit history

A `release.yml` workflow, started by hand on `main`, computes the next version from the conventional commits since the last final `vX.Y.Z` tag, creates an annotated tag with grouped release notes on that commit, and starts `publish.yml` for the tag. Nothing is tagged on push: a release is a decision. The version rules live in `scripts/next-version.mts` and are tested with `node --test`.

We chose this because the project is self-hosted from this repo and ADR-0012 already makes the tag carry the version. A release should be one deliberate action, and the version should come from the history so nobody picks numbers by hand.

## Considered Options

- **release-please.** Rejected: it is driven by pull requests, keeps a release PR open, and commits version bumps to `main`.
- **semantic-release.** Rejected: it releases on every push to `main`, and we want releases on demand.
- **git-cliff.** Rejected: it adds a binary and a `cliff.toml` for rules that fit in a small tested script.
- **mathieudutour/github-tag-action.** Rejected: a third-party action would hold a token that can push tags.
- **A personal access token to push the tag, so that `publish.yml` runs on the tag push.** Rejected: it adds a secret tied to one person. Dispatching `publish.yml` with the workflow's own token avoids that.
- **Turn `publish.yml` into a reusable workflow with explicit version inputs.** Rejected for now: it would rework the ref-based logic that the image tags and the APK version depend on.

## Consequences

- The version comes from the commits alone. No `package.json` or `app.config.ts` holds a version, and CI never commits to `main`.
- When a pull request is squashed, its title becomes the commit subject, so the version depends on conventional PR titles. Nothing enforces that yet. Commits that do not count are listed in the job summary, so drift is visible. A PR-title lint can be added later.
- `feat` is a minor bump, and `fix`, `perf` and `revert` are patch bumps. While the version is 0.x, a breaking change bumps the minor version, so 1.0.0 is a deliberate `release_as` rather than something a `!` triggers.
- The release run requires the newest CI run for its commit to have passed. It does not wait for a run that is still in progress.
- A tag pushed with `GITHUB_TOKEN` starts no other workflow, so `publish.yml` gets a `workflow_dispatch` trigger. That trigger accepts only release tags, so a manual run from a branch cannot move the `dev` release.
- If publishing fails after the tag is pushed, the tag stays and publishing is re-run by hand. The release workflow never deletes a tag.
- Pushing a tag by hand still works. It skips the CI check and the version calculation.
