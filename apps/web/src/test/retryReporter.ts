import { relative } from "node:path";
import type { Reporter, TestCase } from "vitest/node";

// GitHub annotations want repo-root-relative, forward-slash paths.
export function repoPath(root: string, absolute: string): string {
  return relative(root, absolute).split("\\").join("/");
}

// Workflow-command escaping (actions/toolkit): data and property values differ.
function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

// Vitest's github-actions reporter annotates only failures, so a test that
// failed once and passed on its retry would look clean. This reports those.
export function retryReporter({ root, githubActions }: { root: string; githubActions: boolean }): Reporter {
  return {
    onTestCaseResult(testCase: TestCase) {
      try {
        const retries = testCase.diagnostic()?.retryCount ?? 0;
        if (retries === 0 || testCase.result().state !== "passed") return;
        const file = repoPath(root, testCase.module.moduleId);
        const name = testCase.fullName;
        console.log(`RETRIED: ${file} > ${name} (passed after ${retries} ${retries === 1 ? "retry" : "retries"})`);
        if (githubActions) {
          console.log(
            `::warning file=${escapeProperty(file)},title=Retried test::${escapeData(`${name} passed only after a retry`)}`,
          );
        }
      } catch {
        // A reporter must never fail the run.
      }
    },
  };
}
