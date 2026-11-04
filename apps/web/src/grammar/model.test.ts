import type { GrammarPointSummary } from "@vjt/api-client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  boldRuns,
  clampSpan,
  groupByLevel,
  offsetForPage,
  parseExplanation,
  parseLevel,
  parsePage,
  readBrowse,
  saveBrowse,
  statusOf,
} from "./model.ts";

function point(id: number, jlptLevel: string, pattern: string, extra: Record<string, unknown> = {}): GrammarPointSummary {
  return {
    id,
    jlptLevel,
    catalogueNumber: id,
    pattern,
    meaning: `meaning of ${pattern}`,
    hasExplanation: true,
    exampleCount: 0,
    ...extra,
  } as GrammarPointSummary;
}

describe("groupByLevel", () => {
  it("orders the groups easiest first and keeps the server's order inside each", () => {
    const groups = groupByLevel([point(4, "N3", "c"), point(3, "N4", "b"), point(2, "N4", "a"), point(1, "N5", "d")]);
    expect(groups.map((g) => g.level)).toEqual(["N5", "N4", "N3"]);
    expect(groups[1]?.points.map((p) => p.pattern)).toEqual(["b", "a"]);
  });

  it("puts a level outside the known five after them", () => {
    const groups = groupByLevel([point(9, "N9", "x"), point(1, "N5", "y")]);
    expect(groups.map((g) => g.level)).toEqual(["N5", "N9"]);
  });
});

describe("statusOf", () => {
  it("is undefined while the summary has no source, so the screen shows no status (#65)", () => {
    expect(statusOf(point(1, "N5", "a"))).toBeUndefined();
  });

  it("reads seeded as Seeded, and observed or the sync's marumori value as Observed", () => {
    expect(statusOf(point(1, "N5", "a", { source: "seeded" }))).toBe("seeded");
    expect(statusOf(point(2, "N5", "b", { source: "observed" }))).toBe("observed");
    expect(statusOf(point(3, "N5", "c", { source: "marumori" }))).toBe("observed");
  });

  it("reads any other present value as Not known", () => {
    expect(statusOf(point(4, "N5", "d", { source: "something-new" }))).toBe("notKnown");
    expect(statusOf(point(5, "N5", "e", { source: null }))).toBe("notKnown");
  });
});

describe("parseLevel and parsePage", () => {
  it("accepts the five levels and treats anything else as no filter", () => {
    expect(parseLevel("N3")).toBe("N3");
    expect(parseLevel("N9")).toBe("all");
    expect(parseLevel("n3")).toBe("all");
    expect(parseLevel(null)).toBe("all");
  });

  it("reads a 1-based page and treats anything else as page one", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(null)).toBe(1);
    expect(offsetForPage(1)).toBe(0);
    expect(offsetForPage(3)).toBe(100);
  });
});

describe("parseExplanation", () => {
  it("splits paragraphs and runs of bullets", () => {
    expect(parseExplanation("Intro line.\n\n- first point\n- second point\n\nClosing line.")).toEqual([
      { type: "paragraph", text: "Intro line." },
      { type: "list", ordered: false, items: ["first point", "second point"] },
      { type: "paragraph", text: "Closing line." },
    ]);
  });

  it("accepts the other bullet markers a model writes: *, and •", () => {
    expect(parseExplanation("* star item\n• dot item\n-  spaced item")).toEqual([
      { type: "list", ordered: false, items: ["star item", "dot item", "spaced item"] },
    ]);
  });

  it("accepts numbered items as an ordered list, with either 1. or 1)", () => {
    expect(parseExplanation("1. first\n2) second\n10. tenth")).toEqual([
      { type: "list", ordered: true, items: ["first", "second", "tenth"] },
    ]);
  });

  it("ends a list when the kind changes, and when a paragraph comes between", () => {
    expect(parseExplanation("- bullet\n1. numbered\nprose\n- again")).toEqual([
      { type: "list", ordered: false, items: ["bullet"] },
      { type: "list", ordered: true, items: ["numbered"] },
      { type: "paragraph", text: "prose" },
      { type: "list", ordered: false, items: ["again"] },
    ]);
  });

  it("does not treat a hyphen or a number inside a word as a list marker", () => {
    expect(parseExplanation("-not a bullet\n3rd person form")).toEqual([
      { type: "paragraph", text: "-not a bullet" },
      { type: "paragraph", text: "3rd person form" },
    ]);
  });

  it("treats a single newline inside a paragraph as a line break between blocks", () => {
    expect(parseExplanation("one\ntwo")).toEqual([
      { type: "paragraph", text: "one" },
      { type: "paragraph", text: "two" },
    ]);
  });

  it("returns nothing for blank text", () => {
    expect(parseExplanation("  \n\n  ")).toEqual([]);
  });

  it("stays linear on a long line of markers (no backtracking blow-up)", () => {
    const hostile = `${"- ".repeat(20000)}x`;
    const started = performance.now();
    const blocks = parseExplanation(hostile);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(blocks[0]?.type).toBe("list");
  });
});

describe("boldRuns", () => {
  it("alternates plain and bold runs and drops empty ones", () => {
    expect(boldRuns("Form: **verb-te** + iru")).toEqual([
      { text: "Form: ", bold: false },
      { text: "verb-te", bold: true },
      { text: " + iru", bold: false },
    ]);
    expect(boldRuns("**start**")).toEqual([{ text: "start", bold: true }]);
  });

  it("opens bold at an unclosed ** and runs it to the end of the line, as the mobile renderer does", () => {
    expect(boldRuns("a ** b")).toEqual([
      { text: "a ", bold: false },
      { text: " b", bold: true },
    ]);
  });
});

describe("clampSpan", () => {
  it("keeps a good span as it is", () => {
    expect(clampSpan(5, 10, 11)).toEqual({ start: 5, end: 10 });
  });

  it("pulls a start past the sentence back to its end, and a negative start to zero", () => {
    expect(clampSpan(20, 25, 11)).toEqual({ start: 11, end: 11 });
    expect(clampSpan(-3, 4, 11)).toEqual({ start: 0, end: 4 });
  });

  it("pulls an end past the sentence back to its end, and an end before the start up to the start", () => {
    expect(clampSpan(5, 99, 11)).toEqual({ start: 5, end: 11 });
    expect(clampSpan(7, 3, 11)).toEqual({ start: 7, end: 7 });
  });

  it("handles an empty sentence and non-integer offsets", () => {
    expect(clampSpan(0, 5, 0)).toEqual({ start: 0, end: 0 });
    expect(clampSpan(1.7, 3.2, 10)).toEqual({ start: 1, end: 3 });
    expect(clampSpan(Number.NaN, Number.NaN, 4)).toEqual({ start: 0, end: 0 });
  });
});

describe("browse position", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("comes back only for the history entry it was saved from", () => {
    saveBrowse({ key: "entry-a", scrollY: 420 });
    expect(readBrowse("entry-a")).toEqual({ scrollY: 420 });
    expect(readBrowse("entry-b")).toBeNull();
  });

  it("ignores stored data it cannot read", () => {
    window.sessionStorage.setItem("vjt.grammar.browse", "{not json");
    expect(readBrowse("entry-a")).toBeNull();
    window.sessionStorage.setItem("vjt.grammar.browse", JSON.stringify({ key: "entry-a", scrollY: "x" }));
    expect(readBrowse("entry-a")).toBeNull();
  });
});
