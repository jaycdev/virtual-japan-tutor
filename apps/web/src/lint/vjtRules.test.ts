// Probe for the repo's design-token gates. The repo has no RuleTester setup, so this
// runs the real root eslint.config.mjs through ESLint's API on in-memory files, which
// also checks the rules are wired to the right file globs.
import { ESLint } from "eslint";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs from the package directory (apps/web); the config lives at the repo root.
const repoRoot = resolve(process.cwd(), "../..");
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  // Only the design gates: the snippets declare an unused `a`, which is not what is under test.
  return (result?.messages ?? []).map((m) => m.ruleId ?? "").filter((id) => id.startsWith("vjt/"));
}

describe("vjt/no-hardcoded-color", () => {
  it.each([
    ["a plain className literal", 'const a = <p className="text-[#abc]" />;'],
    ["a className template without substitutions", "const a = <p className={`p-2 text-[#abc]`} />;"],
    ["a template chunk next to a substitution", "const a = <p className={`p-2 ${x} text-[#abcdef]`} />;"],
    ["an rgb() literal in a style value", 'const a = <p style={{ color: "rgb(0, 0, 0)" }} />;'],
    ["an rgb() in a template", "const a = <p style={{ color: `rgba(0,0,0,.5)` }} />;"],
  ])("flags %s in apps/web", async (_label, code) => {
    expect(await ruleIds("apps/web/src/probe.tsx", code)).toContain("vjt/no-hardcoded-color");
  });

  it("flags the same pattern in the phone app", async () => {
    expect(await ruleIds("apps/app/src/probe.tsx", "const a = <p className={`p-2 text-[#abc]`} />;")).toContain(
      "vjt/no-hardcoded-color",
    );
  });

  it("passes token classes and var() references", async () => {
    expect(
      await ruleIds(
        "apps/web/src/probe.tsx",
        'const a = <p className={`p-2 text-body text-muted-foreground`} style={{ fontSize: "var(--story-text-size)" }} />;',
      ),
    ).toEqual([]);
  });
});

describe("vjt/no-inline-font-size", () => {
  it.each([
    ["a numeric size", "const a = <p style={{ fontSize: 14 }} />;"],
    ["a DOM px string", 'const a = <p style={{ fontSize: "16px" }} />;'],
    ["a template size with a literal prefix", "const a = <p style={{ fontSize: `16px` }} />;"],
  ])("flags %s", async (_label, code) => {
    expect(await ruleIds("apps/web/src/probe.tsx", code)).toContain("vjt/no-inline-font-size");
  });
});
