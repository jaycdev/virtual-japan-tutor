// Plans a release for CI (ADR-0014). Reads git; the rules live in next-version.mts.
//   node scripts/next-version.mjs [--ref <commit>] [--prerelease] [--release-as <version>]
//                                 [--dry-run] [--notes-file <path>] [--summary-file <path>]
// Prints KEY=value lines for $GITHUB_OUTPUT. When there is a problem it still writes the summary
// (so the job summary explains it), then exits 1 without printing outputs.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { parseGitLog, parseTagList, pickBaseline, planRelease, renderSummary } from "./next-version.mts";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function parseArgs(argv) {
  const opts = {
    ref: "HEAD",
    prerelease: false,
    releaseAs: undefined,
    notesFile: undefined,
    summaryFile: undefined,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case "--ref":
        opts.ref = value();
        break;
      case "--prerelease":
        opts.prerelease = true;
        break;
      case "--release-as":
        opts.releaseAs = value();
        break;
      case "--notes-file":
        opts.notesFile = value();
        break;
      case "--summary-file":
        opts.summaryFile = value();
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }
  return opts;
}

function run(argv) {
  const opts = parseArgs(argv);
  const sha = git(["rev-parse", "--verify", `${opts.ref}^{commit}`]).trim();
  const allTags = parseTagList(git(["tag", "--list"]));
  const baseline = pickBaseline(parseTagList(git(["tag", "--list", "--merged", sha, "v*"])));
  const range = baseline === null ? sha : `${baseline}..${sha}`;
  const commits = parseGitLog(git(["log", "--format=%H%x1f%s%x1f%b%x1e", range]));

  const plan = planRelease({
    commits,
    baseline,
    allTags,
    prerelease: opts.prerelease,
    releaseAs: opts.releaseAs,
  });

  if (opts.notesFile) writeFileSync(opts.notesFile, plan.notes);
  if (opts.summaryFile) writeFileSync(opts.summaryFile, renderSummary(plan, { dryRun: opts.dryRun, sha }));
  if (plan.problem !== null) throw new Error(plan.problem);

  return [
    `TAG=${plan.tag}`,
    `VERSION=${plan.version}`,
    `BASELINE=${plan.baseline ?? ""}`,
    `BUMP=${plan.bump}`,
    `SHA=${sha}`,
  ].join("\n") + "\n";
}

try {
  process.stdout.write(run(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
