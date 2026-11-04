import type { GrammarPointSummary } from "@vjt/api-client";
import { beforeEach, describe, expect, it } from "vitest";

import { boldRuns, groupByLevel, knowledgeOf, parseExplanation, readBrowse, saveBrowse } from "./model.ts";

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
    const groups = groupByLevel([
      point(4, "N3", "c"),
      point(3, "N4", "b"),
      point(2, "N4", "a"),
      point(1, "N5", "d"),
    ]);
    expect(groups.map((g) => g.level)).toEqual(["N5", "N4", "N3"]);
    expect(groups[1]?.points.map((p) => p.pattern)).toEqual(["b", "a"]);
  });

  it("puts a level outside the known five after them", () => {
    const groups = groupByLevel([point(9, "N9", "x"), point(1, "N5", "y")]);
    expect(groups.map((g) => g.level)).toEqual(["N5", "N9"]);
  });
});

describe("knowledgeOf", () => {
  it("reads seeded, observed and the sync's own marumori value as observed", () => {
    expect(knowledgeOf(point(1, "N5", "a", { source: "seeded" }))).toBe("seeded");
    expect(knowledgeOf(point(2, "N5", "b", { source: "observed" }))).toBe("observed");
    expect(knowledgeOf(point(3, "N5", "c", { source: "marumori" }))).toBe("observed");
  });

  it("is undefined when the summary carries no source, as the list API does today (#65)", () => {
    expect(knowledgeOf(point(4, "N5", "d"))).toBeUndefined();
  });
});

describe("parseExplanation", () => {
  it("splits paragraphs and runs of bullets, and keeps each bullet's text", () => {
    expect(
      parseExplanation("Intro line.\n\n- first point\n- second point\n\nClosing line."),
    ).toEqual([
      { type: "paragraph", text: "Intro line." },
      { type: "list", items: ["first point", "second point"] },
      { type: "paragraph", text: "Closing line." },
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

describe("browse position", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("comes back only for the history entry it was saved from", () => {
    saveBrowse({ key: "entry-a", offset: 50, scrollY: 420 });
    expect(readBrowse("entry-a")).toEqual({ offset: 50, scrollY: 420 });
    expect(readBrowse("entry-b")).toBeNull();
  });

  it("ignores stored data it cannot read", () => {
    window.sessionStorage.setItem("vjt.grammar.browse", "{not json");
    expect(readBrowse("entry-a")).toBeNull();
    window.sessionStorage.setItem("vjt.grammar.browse", JSON.stringify({ key: "entry-a", offset: "x", scrollY: 1 }));
    expect(readBrowse("entry-a")).toBeNull();
  });
});
