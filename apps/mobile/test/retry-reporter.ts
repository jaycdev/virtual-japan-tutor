import type { Reporter, TestCase } from "vitest/node";

// Vitest's github-actions reporter annotates only failures, so a test that
// failed once and passed on its retry would look clean. This reports those.
export function retryReporter({ githubActions }: { githubActions: boolean }): Reporter {
  return {
    onTestCaseResult(testCase: TestCase) {
      const retries = testCase.diagnostic()?.retryCount ?? 0;
      if (retries === 0 || testCase.result().state !== "passed") return;
      const file = testCase.module.relativeModuleId;
      const name = `${file} > ${testCase.fullName}`;
      console.log(`RETRIED: ${name} (passed after ${retries} ${retries === 1 ? "retry" : "retries"})`);
      if (githubActions) {
        console.log(`::warning file=${file},title=Retried test::${testCase.fullName} passed only after a retry`);
      }
    },
  };
}
