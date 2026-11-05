import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyse,
  nextRcNumber,
  nextVersion,
  parseGitLog,
  pickBaseline,
  planRelease,
  renderNotes,
  renderSummary,
} from "./next-version.mts";
import type { PlanInput, RawCommit } from "./next-version.mts";

const sha = "1234567890abcdef";
const commit = (subject: string, body = ""): RawCommit => ({ sha, subject, body });
const input = (overrides: Partial<PlanInput>): PlanInput => ({
  commits: [],
  baseline: null,
  allTags: [],
  prerelease: false,
  ...overrides,
});

describe("parseGitLog", () => {
  it("splits records and keeps multi-line bodies", () => {
    const out = "aaaaaaa1\x1ffeat(x): one\x1fbody line\x1e\nbbbbbbb2\x1ffix: two\x1f\x1e\n";
    assert.deepEqual(parseGitLog(out), [
      { sha: "aaaaaaa1", subject: "feat(x): one", body: "body line" },
      { sha: "bbbbbbb2", subject: "fix: two", body: "" },
    ]);
  });
});

describe("analyse", () => {
  it("reads type, scope and description, and maps feat to a minor bump", () => {
    const a = analyse(commit("feat(reader): show the SRS level"));
    assert.equal(a.type, "feat");
    assert.equal(a.scope, "reader");
    assert.equal(a.description, "show the SRS level");
    assert.equal(a.shortSha, "1234567");
    assert.equal(a.breaking, false);
    assert.equal(a.bump, "minor");
  });

  it("maps fix, perf and revert to a patch bump", () => {
    for (const type of ["fix", "perf", "revert"]) {
      assert.equal(analyse(commit(`${type}: something`)).bump, "patch", type);
    }
  });

  it("treats ! and a BREAKING CHANGE footer as breaking, whatever the type", () => {
    assert.equal(analyse(commit("feat!: drop the v1 API")).bump, "major");
    assert.equal(analyse(commit("docs(api): rename", "Details\n\nBREAKING CHANGE: the path moved")).bump, "major");
    assert.equal(analyse(commit("ci!: require Node 24")).breaking, true);
  });

  it("does not count quiet types", () => {
    const a = analyse(commit("docs(readme): tidy"));
    assert.equal(a.bump, null);
    assert.equal(a.reason, '"docs" does not change the released app');
  });

  it("ignores subjects that are not conventional commits", () => {
    const a = analyse(commit("Merge pull request #5 from x/y"));
    assert.equal(a.type, null);
    assert.equal(a.bump, null);
    assert.equal(a.reason, "not a conventional commit");
  });

  it("does not count unknown types", () => {
    const a = analyse(commit("wip: halfway"));
    assert.equal(a.bump, null);
    assert.equal(a.reason, 'unknown type "wip"');
  });
});

describe("nextVersion", () => {
  it("bumps the part it names and resets the parts below it", () => {
    assert.deepEqual(nextVersion({ major: 1, minor: 4, patch: 2 }, "patch"), { major: 1, minor: 4, patch: 3 });
    assert.deepEqual(nextVersion({ major: 1, minor: 4, patch: 2 }, "minor"), { major: 1, minor: 5, patch: 0 });
    assert.deepEqual(nextVersion({ major: 1, minor: 4, patch: 2 }, "major"), { major: 2, minor: 0, patch: 0 });
  });

  it("bumps the minor for a breaking change while the version is 0.x", () => {
    assert.deepEqual(nextVersion({ major: 0, minor: 3, patch: 7 }, "major"), { major: 0, minor: 4, patch: 0 });
  });
});

describe("pickBaseline", () => {
  it("takes the highest final release in the list", () => {
    assert.equal(pickBaseline(["v0.9.0", "v0.10.0", "v0.1.0-rc.1", "dev"]), "v0.10.0");
  });

  it("returns null when no final release is reachable", () => {
    assert.equal(pickBaseline(["v0.1.0-rc.1", "dev"]), null);
  });
});

describe("nextRcNumber", () => {
  it("adds one to the highest candidate of the same base version", () => {
    assert.equal(nextRcNumber(["v0.2.0-rc.1", "v0.2.0-rc.3", "v0.1.0-rc.9"], "0.2.0"), 4);
  });

  it("starts at 1 when there is none", () => {
    assert.equal(nextRcNumber(["v0.1.0"], "0.2.0"), 1);
  });
});

describe("planRelease", () => {
  it("counts the whole history for the first release", () => {
    const plan = planRelease(
      input({ commits: [commit("feat(a): one"), commit("fix(b): two"), commit("docs(c): three")] }),
    );
    assert.equal(plan.tag, "v0.1.0");
    assert.equal(plan.version, "0.1.0");
    assert.equal(plan.bump, "minor");
    assert.equal(plan.problem, null);
  });

  it("takes a patch bump from the baseline", () => {
    const plan = planRelease(input({ baseline: "v0.1.0", commits: [commit("fix: x")] }));
    assert.equal(plan.tag, "v0.1.1");
  });

  it("bumps a breaking change in 0.x to the next minor", () => {
    const plan = planRelease(input({ baseline: "v0.1.4", commits: [commit("feat!: y"), commit("fix: z")] }));
    assert.equal(plan.tag, "v0.2.0");
  });

  it("bumps a breaking change after 1.0 to the next major", () => {
    const plan = planRelease(input({ baseline: "v1.2.3", commits: [commit("fix: a"), commit("feat!: b")] }));
    assert.equal(plan.tag, "v2.0.0");
  });

  it("refuses to release when no commit counts", () => {
    const plan = planRelease(
      input({ baseline: "v0.1.0", commits: [commit("docs: x"), commit("ci: y"), commit("Merge pull request #9")] }),
    );
    assert.equal(plan.tag, null);
    assert.equal(plan.bump, null);
    assert.match(plan.problem ?? "", /^nothing to release/);
  });

  it("numbers release candidates after the last existing one", () => {
    const plan = planRelease(
      input({
        baseline: "v0.1.0",
        commits: [commit("feat: x")],
        allTags: ["v0.2.0-rc.1", "v0.2.0-rc.2"],
        prerelease: true,
      }),
    );
    assert.equal(plan.tag, "v0.2.0-rc.3");
  });

  it("starts release candidates at rc.1", () => {
    const plan = planRelease(input({ commits: [commit("feat: x")], prerelease: true }));
    assert.equal(plan.tag, "v0.1.0-rc.1");
  });

  it("forces an exact version with release_as", () => {
    const plan = planRelease(input({ baseline: "v0.1.0", commits: [commit("docs: x")], releaseAs: "1.0.0" }));
    assert.equal(plan.tag, "v1.0.0");
    assert.equal(plan.bump, "manual");
    assert.equal(plan.problem, null);
  });

  it("accepts a release candidate in release_as", () => {
    const plan = planRelease(input({ baseline: "v0.1.0", commits: [], releaseAs: "0.2.0-rc.1" }));
    assert.equal(plan.tag, "v0.2.0-rc.1");
  });

  it("refuses a release_as that is not above the baseline", () => {
    const plan = planRelease(input({ baseline: "v0.2.0", commits: [commit("fix: x")], releaseAs: "0.2.0" }));
    assert.equal(plan.tag, null);
    assert.match(plan.problem ?? "", /must be greater than the baseline/);
  });

  it("refuses a malformed release_as", () => {
    const plan = planRelease(input({ releaseAs: "v1.0.0" }));
    assert.equal(plan.tag, null);
    assert.match(plan.problem ?? "", /is not X\.Y\.Z or X\.Y\.Z-rc\.N/);
  });

  it("refuses a tag that already exists", () => {
    const plan = planRelease(input({ baseline: "v0.1.0", commits: [commit("fix: x")], allTags: ["v0.1.1"] }));
    assert.equal(plan.tag, null);
    assert.equal(plan.problem, "tag v0.1.1 already exists");
  });

  it("refuses prerelease combined with release_as", () => {
    assert.throws(() => planRelease(input({ prerelease: true, releaseAs: "1.0.0" })), /cannot be combined/);
  });
});

describe("renderNotes", () => {
  it("groups commits into sections and bolds scopes", () => {
    const notes = renderNotes([
      analyse(commit("feat(reader): add a thing")),
      analyse(commit("fix: correct it")),
      analyse(commit("perf(core): faster")),
      analyse(commit("feat!: break")),
    ]);
    assert.equal(
      notes,
      "### Breaking changes\n\n- break (1234567)\n\n### Features\n\n- **reader:** add a thing (1234567)\n\n" +
        "### Fixes\n\n- correct it (1234567)\n\n### Performance\n\n- **core:** faster (1234567)\n",
    );
  });

  it("says so when nothing user-facing is in the release", () => {
    assert.equal(renderNotes([analyse(commit("docs: x"))]), "No user-facing changes in this release.\n");
  });
});

describe("renderSummary", () => {
  it("explains why nothing was tagged and lists the commits that did not count", () => {
    const plan = planRelease(input({ baseline: "v0.1.0", commits: [commit("docs: x")] }));
    const summary = renderSummary(plan, { dryRun: false, sha });
    assert.ok(summary.includes("**Stopped:** nothing to release"));
    assert.ok(summary.includes('- `1234567` docs: x: "docs" does not change the released app'));
  });
});
