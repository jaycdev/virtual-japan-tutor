// The Settings sentences (issue #125): the plain helpers and their RubyText
// twins must agree on the words — a plain UI and one that draws readings say
// the same sentence — and only the twins keep the readings in ja-furigana.

import type { GrammarReviewItem, MaruMoriSyncRun } from "@vjt/api-client";
import { describe, expect, it } from "vitest";

import {
  grammarReviewRuby,
  grammarReviewText,
  grammarUpdatedRuby,
  grammarUpdatedText,
  syncOutcomeRuby,
  syncOutcomeText,
  syncRunRuby,
  syncRunText,
} from "./settingsText.ts";

/** Segments joined to the sentence they draw — what a plain UI shows. */
function joined(segments: ReturnType<typeof syncOutcomeRuby>): string {
  return segments.map((s) => s.text).join("");
}

const counts: MaruMoriSyncRun["counts"] = {
  kanji: 920,
  vocabulary: 1400,
  grammarReviews: 40,
  grammarLessons: 12,
  linked: 1022,
  unlinked: 378,
  ambiguous: 6,
  new: 5,
  levelChanges: 1,
  disappeared: 0,
  skippedLevelZero: 2,
};

const run: MaruMoriSyncRun = {
  id: "run-1",
  status: "ok",
  startedAt: "2026-11-01T20:12:00Z",
  counts,
};

const failedRun: MaruMoriSyncRun = {
  id: "run-2",
  status: "failed",
  startedAt: "2026-11-02T08:00:00Z",
  error: "MaruMori is unreachable",
};

describe("sync outcome and run lines", () => {
  it("the twins say the same English sentence the sections always showed", () => {
    expect(syncOutcomeText(run)).toBe(
      "Sync complete — 5 new Known Items, 1 level changes, 0 disappeared",
    );
    expect(joined(syncOutcomeRuby(run))).toBe(syncOutcomeText(run));
    expect(syncRunText(run)).toBe("2026-11-01T20:12:00Z — ok — 920 kanji, 1400 vocabulary");
    expect(joined(syncRunRuby(run))).toBe(syncRunText(run));
  });

  it("a failed run keeps the server's words and only ours are translated", () => {
    expect(syncOutcomeText(failedRun)).toBe("Sync failed: MaruMori is unreachable");
    expect(syncOutcomeRuby(failedRun).map((s) => s.text).join("")).toBe(syncOutcomeText(failedRun));
    // No counts and no error: the counts part is simply absent, in both.
    const bare: MaruMoriSyncRun = { id: "run-3", status: "ok", startedAt: "2026-11-03T00:00:00Z" };
    expect(syncRunText(bare)).toBe("2026-11-03T00:00:00Z — ok");
    expect(joined(syncRunRuby(bare))).toBe(syncRunText(bare));
  });

  it("ja-furigana keeps readings on our words only", () => {
    const segments = syncOutcomeRuby(run, "ja-furigana");
    // Our first word carries its reading; the numbers ride plain.
    expect(segments[0]).toEqual({ text: "同期", ruby: "どうき" });
    expect(joined(segments)).toContain("5");
    // ja drops the notation and shows the plain sentence.
    expect(joined(syncOutcomeRuby(run, "ja"))).toBe(syncOutcomeText(run, "ja"));
    // The run row: server data unannotated, our connectives annotated.
    const row = syncRunRuby(run, "ja-furigana");
    expect(row[0]).toEqual({ text: "2026-11-01T20:12:00Z — ok — " });
    expect(row.some((s) => s.ruby === "かんじ")).toBe(true);
  });
});

describe("grammar review rows and the Starting Level result", () => {
  const item: GrammarReviewItem = {
    marumoriId: "Grammar/6578",
    pattern: "〜未知",
    jlptLevel: "N4",
    matchedPointId: 12,
    flagged: true,
  };
  const unmatched: GrammarReviewItem = { marumoriId: "Grammar/1", pattern: "", flagged: true };

  it("the Pattern rides through unannotated in every language", () => {
    expect(grammarReviewText(item)).toBe(
      "〜未知 (MaruMori level N4) — matched point 12, level was ambiguous",
    );
    // en: nothing is annotated, so the whole row is one plain segment.
    expect(grammarReviewRuby(item).every((s) => s.ruby === undefined)).toBe(true);
    // ja-furigana: the Pattern still opens the row, reading-free; only our
    // connectives behind it grow readings.
    const row = grammarReviewRuby(item, "ja-furigana");
    expect(row[0]).toEqual({ text: "〜未知 （MaruMori レベル N4） — " });
    expect(row.some((s) => s.ruby !== undefined)).toBe(true);
    expect(joined(row)).toContain("〜未知");
  });

  it("an unmatched observation falls back to the MaruMori id and the no-match line", () => {
    expect(grammarReviewText(unmatched)).toBe("Grammar/1 — no Grammar Catalogue match");
    expect(joined(grammarReviewRuby(unmatched))).toBe(grammarReviewText(unmatched));
    expect(joined(grammarReviewRuby(unmatched, "ja"))).toBe(grammarReviewText(unmatched, "ja"));
  });

  it("the updated line keeps the exact counts sentence", () => {
    expect(grammarUpdatedText({ added: 120, removed: 3 })).toBe(
      "Grammar updated: 120 added, 3 removed.",
    );
    expect(joined(grammarUpdatedRuby({ added: 120, removed: 3 }))).toBe(
      grammarUpdatedText({ added: 120, removed: 3 }),
    );
    expect(grammarUpdatedRuby({ added: 120, removed: 3 }, "ja-furigana")[0]).toEqual({
      text: "文法",
      ruby: "ぶんぽう",
    });
  });
});
