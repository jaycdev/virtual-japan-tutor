// Version rules for tagged releases (ADR-0014). Pure functions only: scripts/next-version.mjs
// reads git and calls planRelease. Covered by scripts/next-version.test.mts.

export type Semver = { major: number; minor: number; patch: number };
export type Bump = "patch" | "minor" | "major";

export type RawCommit = { sha: string; subject: string; body: string };

export type Analysed = {
  sha: string;
  shortSha: string;
  subject: string;
  /** Null when the subject is not a conventional commit. */
  type: string | null;
  scope: string | null;
  description: string;
  breaking: boolean;
  /** Null when the commit does not drive the release. */
  bump: Bump | null;
  /** Why the commit does not drive the release; null when it does. */
  reason: string | null;
};

export type PlanInput = {
  /** Commits after the baseline (or the whole history when there is none), in any order. */
  commits: RawCommit[];
  /** Latest final release tag reachable from the target commit, such as "v0.1.0", or null. */
  baseline: string | null;
  /** Every tag in the repository, so an existing tag is never created again. */
  allTags: string[];
  prerelease: boolean;
  /** Exact version without the leading "v": "X.Y.Z" or "X.Y.Z-rc.N". */
  releaseAs?: string;
};

export type Plan = {
  baseline: string | null;
  /** "manual" when release_as sets the version. */
  bump: Bump | "manual" | null;
  analysed: Analysed[];
  notes: string;
  tag: string | null;
  version: string | null;
  /** Why no tag can be made; null when the plan is good. */
  problem: string | null;
};

const SUBJECT = /^([a-z]+)(?:\(([^()\n]*)\))?(!)?: (.+)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
const QUIET_TYPES = new Set(["docs", "ci", "test", "chore", "refactor", "data", "build", "style"]);
const FINAL_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RC_TAG = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-rc\.([1-9]\d*)$/;
const RELEASE_AS = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-rc\.[1-9]\d*)?$/;
const BUMP_ORDER: Bump[] = ["patch", "minor", "major"];
const ZERO: Semver = { major: 0, minor: 0, patch: 0 };

export function parseFinalTag(tag: string): Semver | null {
  const match = FINAL_TAG.exec(tag);
  return match === null ? null : parseCore(`${match[1]}.${match[2]}.${match[3]}`);
}

function parseCore(core: string): Semver {
  const [major, minor, patch] = core.split(".").map(Number);
  return { major, minor, patch };
}

export function formatSemver(version: Semver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The highest final release tag in the list; release candidates and other tags are ignored. */
export function pickBaseline(reachableTags: string[]): string | null {
  let best: { tag: string; version: Semver } | null = null;
  for (const tag of reachableTags) {
    const version = parseFinalTag(tag);
    if (version !== null && (best === null || compareSemver(version, best.version) > 0)) {
      best = { tag, version };
    }
  }
  return best === null ? null : best.tag;
}

/** The number for the next release candidate of a base version: highest existing rc plus one. */
export function nextRcNumber(allTags: string[], core: string): number {
  let highest = 0;
  for (const tag of allTags) {
    const match = RC_TAG.exec(tag);
    if (match !== null && match[1] === core) {
      highest = Math.max(highest, Number(match[2]));
    }
  }
  return highest + 1;
}

export function nextVersion(base: Semver, bump: Bump): Semver {
  if (bump === "major") {
    // While the version is 0.x, a breaking change bumps the minor version (ADR-0014).
    return base.major === 0
      ? { major: 0, minor: base.minor + 1, patch: 0 }
      : { major: base.major + 1, minor: 0, patch: 0 };
  }
  if (bump === "minor") {
    return { major: base.major, minor: base.minor + 1, patch: 0 };
  }
  return { major: base.major, minor: base.minor, patch: base.patch + 1 };
}

export function highestBump(bumps: Bump[]): Bump | null {
  let best: Bump | null = null;
  for (const bump of bumps) {
    if (best === null || BUMP_ORDER.indexOf(bump) > BUMP_ORDER.indexOf(best)) {
      best = bump;
    }
  }
  return best;
}

/** Parses `git log --format=%H%x1f%s%x1f%b%x1e` output. */
export function parseGitLog(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const record of output.split("\x1e")) {
    const trimmed = record.replace(/^\n+/, "");
    if (trimmed.trim() === "") continue;
    const [sha, subject = "", body = ""] = trimmed.split("\x1f");
    commits.push({ sha: sha.trim(), subject: subject.trim(), body: body.trim() });
  }
  return commits;
}

export function parseTagList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function analyse(commit: RawCommit): Analysed {
  const shortSha = commit.sha.slice(0, 7);
  const match = SUBJECT.exec(commit.subject);
  if (match === null) {
    return {
      sha: commit.sha,
      shortSha,
      subject: commit.subject,
      type: null,
      scope: null,
      description: commit.subject,
      breaking: false,
      bump: null,
      reason: "not a conventional commit",
    };
  }

  const type = match[1];
  const scope = match[2] ?? null;
  const description = match[4];
  const breaking = match[3] === "!" || BREAKING_FOOTER.test(commit.body);

  let bump: Bump | null = null;
  if (breaking) bump = "major";
  else if (type === "feat") bump = "minor";
  else if (type === "fix" || type === "perf" || type === "revert") bump = "patch";

  let reason: string | null = null;
  if (bump === null) {
    reason = QUIET_TYPES.has(type) ? `"${type}" does not change the released app` : `unknown type "${type}"`;
  }

  return {
    sha: commit.sha,
    shortSha,
    subject: commit.subject,
    type,
    scope,
    description,
    breaking,
    bump,
    reason,
  };
}

const NOTE_SECTIONS: [string, (a: Analysed) => boolean][] = [
  ["Breaking changes", (a) => a.breaking],
  ["Features", (a) => !a.breaking && a.type === "feat"],
  ["Fixes", (a) => !a.breaking && (a.type === "fix" || a.type === "revert")],
  ["Performance", (a) => !a.breaking && a.type === "perf"],
];

/** Release notes for the commits that drive the release, grouped by section. */
export function renderNotes(analysed: Analysed[]): string {
  const counted = analysed.filter((a) => a.bump !== null);
  const blocks: string[] = [];
  for (const [title, include] of NOTE_SECTIONS) {
    const lines = counted.filter(include).map((a) => {
      const scope = a.scope === null ? "" : `**${a.scope}:** `;
      return `- ${scope}${a.description} (${a.shortSha})`;
    });
    if (lines.length > 0) blocks.push(`### ${title}\n\n${lines.join("\n")}`);
  }
  return blocks.length === 0 ? "No user-facing changes in this release.\n" : `${blocks.join("\n\n")}\n`;
}

export function planRelease(input: PlanInput): Plan {
  if (input.prerelease && input.releaseAs !== undefined) {
    throw new Error("--prerelease and --release-as cannot be combined; write -rc.N in the version instead");
  }
  const analysed = input.commits.map(analyse);
  const plan: Plan = {
    baseline: input.baseline,
    bump: null,
    analysed,
    notes: renderNotes(analysed),
    tag: null,
    version: null,
    problem: null,
  };

  const base = input.baseline === null ? ZERO : parseFinalTag(input.baseline);
  if (base === null) {
    throw new Error(`baseline is not a final release tag: ${input.baseline}`);
  }
  const since = input.baseline ?? "the start of history";

  let version: string;
  if (input.releaseAs !== undefined) {
    plan.bump = "manual";
    const match = RELEASE_AS.exec(input.releaseAs);
    if (match === null) {
      return { ...plan, problem: `release_as "${input.releaseAs}" is not X.Y.Z or X.Y.Z-rc.N` };
    }
    if (compareSemver(parseCore(match[1]), base) <= 0) {
      return { ...plan, problem: `release_as ${input.releaseAs} must be greater than the baseline (${since})` };
    }
    version = input.releaseAs;
  } else {
    const bump = highestBump(analysed.flatMap((a) => (a.bump === null ? [] : [a.bump])));
    plan.bump = bump;
    if (bump === null) {
      return {
        ...plan,
        problem: `nothing to release: no commit since ${since} changes the released app. Use release_as to force a version.`,
      };
    }
    const core = formatSemver(nextVersion(base, bump));
    version = input.prerelease ? `${core}-rc.${nextRcNumber(input.allTags, core)}` : core;
  }

  const tag = `v${version}`;
  if (input.allTags.includes(tag)) {
    return { ...plan, problem: `tag ${tag} already exists` };
  }
  return { ...plan, tag, version };
}

/** Markdown for the job summary: the decision, the commits behind it, and the notes. */
export function renderSummary(plan: Plan, options: { dryRun: boolean; sha: string }): string {
  const counted = plan.analysed.filter((a) => a.bump !== null);
  const ignored = plan.analysed.filter((a) => a.bump === null);
  const lines = [
    plan.tag === null ? "## No release" : `## Release ${plan.tag}`,
    "",
    `- Commit: \`${options.sha.slice(0, 7)}\``,
    `- Baseline: ${plan.baseline ?? "none (counting the whole history)"}`,
    `- Bump: ${plan.bump ?? "none"}`,
    `- Mode: ${options.dryRun ? "dry run, no tag is created" : "tag and publish"}`,
  ];
  if (plan.problem !== null) {
    lines.push("", `**Stopped:** ${plan.problem}`);
  }
  lines.push("", "### Commits that drive the bump", "");
  if (counted.length === 0) lines.push("- none");
  for (const a of counted) lines.push(`- \`${a.shortSha}\` ${a.subject} (${a.bump})`);
  lines.push("", "### Commits that do not count", "");
  if (ignored.length === 0) lines.push("- none");
  for (const a of ignored) lines.push(`- \`${a.shortSha}\` ${a.subject}: ${a.reason}`);
  lines.push("", "### Release notes", "", plan.notes);
  return `${lines.join("\n")}\n`;
}
