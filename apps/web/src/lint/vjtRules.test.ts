// Probe for the repo's design-token gates. The repo has no RuleTester setup, so this
// runs the real root eslint.config.mjs through ESLint's API on in-memory files, which
// also checks the rules are wired to the right file globs.
/* eslint-disable vjt/no-hardcoded-color -- the probe inputs are colour literals on purpose */
import { ESLint } from "eslint";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// vitest runs from the package directory (apps/web); the config lives at the repo root.
const repoRoot = resolve(process.cwd(), "../..");
const eslint = new ESLint({ cwd: repoRoot });

// The first lintText on an ESLint instance resolves the root config and loads ESLint
// and the matched plugins cold; on a shared runner that alone can pass 15 s. Absorb
// it once here (hook timeout, so no case body pays for it) and every case below
// keeps the normal test timeout.
beforeAll(async () => {
  await eslint.lintText("", { filePath: "apps/web/src/probe.tsx" });
}, 60_000);

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
    expect(await ruleIds("apps/mobile/src/probe.tsx", "const a = <p className={`p-2 text-[#abc]`} />;")).toContain(
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

describe("vjt/no-raw-jsx-text (#125)", () => {
  it.each([
    ["plain text in a JSX child", 'const a = <p>Interface text</p>;'],
    ["text in a component child", 'const a = <SheetTitle>Reading settings</SheetTitle>;'],
    ["a bare string expression child", 'const a = <p>{"Interface text"}</p>;'],
    ["multi-line JSX text", "const a = (\n  <p>\n    Interface text\n  </p>\n);"],
    ["a ternary child", 'const a = <p>{ok ? "Saved" : "Failed"}</p>;'],
    ["an && child", 'const a = <p>{ready && "Ready"}</p>;'],
    ["a template child with words", "const a = <p>{`Page ${n} of 3`}</p>;"],
    ["a raw aria-label attribute", 'const a = <button aria-label="Close" />;'],
    ["a string-expression aria-label attribute", 'const a = <button aria-label={"Close"} />;'],
    ["a raw label prop", 'const a = <TextField label="Name" />;'],
    ["a template in a message prop", "const a = <EmptyState message={`Nothing ${x} here`} />;"],
    ["a ternary in a legend prop", 'const a = <ChoiceGroup legend={open ? "Less" : "More"} />;'],
  ])("flags %s in apps/web", async (_label, code) => {
    expect(await ruleIds("apps/web/src/probe.tsx", code)).toContain("vjt/no-raw-jsx-text");
  });

  it.each([
    ["punctuation only", 'const a = <span>(</span>;'],
    ["a middle dot separator", 'const a = <span>·</span>;'],
    ["a digit-only count", "<span>3</span>;"],
    ["a count template with no words", "const a = <p>{`${n} / ${total}`}</p>;"],
    ["an interpolated learning-content prop", "const a = <p>{item.meaningEn}</p>;"],
    ["a table-backed translation", 'const a = <T k="nav.practice" />;'],
    ["a translated aria-label", 'const a = <button aria-label={tp("nav.practice")} />;'],
    ["a ternary of elements", 'const a = <p>{ok ? <T k="x.saved" /> : null}</p>;'],
    ["class names are not copy", 'const a = <p className="text-body font-semibold">{null}</p>;'],
  ])("passes %s", async (_label, code) => {
    expect(await ruleIds("apps/web/src/probe.tsx", code)).not.toContain("vjt/no-raw-jsx-text");
  });

  it.each([
    ["a raw accessibilityLabel", 'const a = <Pressable accessibilityLabel="Close" />;'],
    ["a string-expression accessibilityLabel", 'const a = <Pressable accessibilityLabel={"Close"} />;'],
    ["a raw accessibilityHint", 'const a = <Pressable accessibilityHint="Opens the reader" />;'],
    ["a string-expression accessibilityValue", 'const a = <Slider accessibilityValue={"3 of 5"} />;'],
  ])("flags %s in apps/mobile (#125 PR 3)", async (_label, code) => {
    expect(await ruleIds("apps/mobile/src/probe.tsx", code)).toContain("vjt/no-raw-jsx-text");
  });

  it("applies to apps/mobile source and not to its tests", async () => {
    expect(await ruleIds("apps/mobile/src/probe.tsx", "const a = <p>Interface text</p>;")).toContain(
      "vjt/no-raw-jsx-text",
    );
    expect(await ruleIds("apps/mobile/src/probe.test.tsx", "const a = <p>Interface text</p>;")).not.toContain(
      "vjt/no-raw-jsx-text",
    );
  });

  it("passes a translated accessibilityLabel in apps/mobile", async () => {
    expect(
      await ruleIds("apps/mobile/src/probe.tsx", 'const a = <Pressable accessibilityLabel={tp("nav.back")} />;'),
    ).not.toContain("vjt/no-raw-jsx-text");
  });
});
