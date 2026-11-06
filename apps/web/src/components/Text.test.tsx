// The three render modes of a table entry (issue #125): English is the sentence,
// plain Japanese is the sentence in kanji, and Japanese (furigana) wraps each
// annotated kanji run in <ruby>/<rt> at the furigana token size.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InterfaceLanguageProvider, type InterfaceLanguage } from "@vjt/core";

import { T } from "./Text.tsx";

function renderT(language: InterfaceLanguage, k: "settings.focusAria" | "lists.itemsHeading", params?: { count: number }) {
  return render(
    <InterfaceLanguageProvider language={language} setLanguage={() => undefined}>
      <T k={k} params={params} />
    </InterfaceLanguageProvider>,
  );
}

describe("T", () => {
  it("renders the English entry as plain text", () => {
    const { container } = renderT("en", "settings.focusAria");
    expect(container.textContent).toBe("Focus Set");
    expect(container.querySelectorAll("ruby")).toHaveLength(0);
  });

  it("renders the Japanese entry without any furigana markup", () => {
    const { container } = renderT("ja", "settings.focusAria");
    expect(container.textContent).toBe("重点項目");
    expect(container.querySelectorAll("ruby")).toHaveLength(0);
  });

  it("wraps every annotated run in <ruby><rt> for the furigana mode", () => {
    const { container } = renderT("ja-furigana", "settings.focusAria");
    const ruby = Array.from(container.querySelectorAll("ruby"));
    expect(ruby).toHaveLength(1);
    expect(ruby[0]?.textContent).toBe("重点項目じゅうてんこうもく");
    const rt = Array.from(container.querySelectorAll("rt"));
    expect(rt.map((e) => e.textContent)).toEqual(["じゅうてんこうもく"]);
    // The furigana token classes (ui-plan typography), not an inline size.
    for (const e of rt) expect(e.className).toContain("text-furigana");
  });

  it("keeps params intact across the segments", () => {
    const { container } = renderT("en", "lists.itemsHeading", { count: 3 });
    expect(container.textContent).toBe("Items (3)");
  });
});
