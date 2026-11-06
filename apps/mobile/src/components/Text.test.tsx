// The three render modes of a table entry on the phone (issue #125): English is
// the plain sentence, plain Japanese is the sentence in kanji, and Japanese
// (furigana) stands each annotated unit up as the reader stands its words —
// a reading column above its base, in a wrapping row. Screen readers get the
// sentence plain either way: the columns are hidden and the container carries
// one clean label.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { InterfaceLanguageProvider, type InterfaceLanguage, type StringKey } from "@vjt/core";
import type { ReactNode } from "react";

import { chromeFuriganaPx, labelAria, T, useTp } from "./Text.tsx";

function renderT(language: InterfaceLanguage, k: StringKey, params?: Record<string, string | number>, className?: string) {
  return render(
    <InterfaceLanguageProvider language={language} setLanguage={() => undefined}>
      <T k={k} params={params} className={className} />
    </InterfaceLanguageProvider>,
  );
}

describe("T", () => {
  it("renders the English entry as one plain line", () => {
    const { container } = renderT("en", "settings.focusAria");
    expect(container.textContent).toBe("Focus Set");
    // No reading columns: no inline reading size anywhere.
    expect(container.querySelectorAll("[style*='font-size']")).toHaveLength(0);
  });

  it("renders the Japanese entry without any readings", () => {
    const { container } = renderT("ja", "settings.focusAria");
    expect(container.textContent).toBe("重点項目");
    expect(container.querySelectorAll("[style*='font-size']")).toHaveLength(0);
  });

  it("stands each annotated unit in its own reading column for the furigana mode", () => {
    // Two annotated words → two columns, each carrying its reading inline.
    const { container } = renderT("ja-furigana", "errors.invalid_settings");
    // 設定《せってい》が正《ただ》しくありません — one unit per word.
    const readings = Array.from(container.querySelectorAll("[style*='font-size']"));
    expect(readings).toHaveLength(2);
    expect(readings.map((r) => r.textContent)).toEqual(["せってい", "ただ"]);
  });

  it("names the line with the plain Japanese, readings left out", () => {
    const { container } = renderT("ja-furigana", "settings.focusAria");
    const line = container.querySelector("[aria-label='重点項目']");
    expect(line).not.toBeNull();
    // The drawn reading is inside, at half the base size.
    expect(line?.querySelector("[style*='font-size']")?.textContent).toBe("じゅうてんこうもく");
  });

  it("keeps params intact across the segments", () => {
    const { container } = renderT("en", "lists.itemsHeading", { count: 3 });
    expect(container.textContent).toBe("Items (3)");
  });

  it("sets the reading to half the line's size, never under 9px", () => {
    expect(chromeFuriganaPx(12)).toBe(9); // caption: 6 floors to 9
    expect(chromeFuriganaPx(16)).toBe(9); // body: 8 floors to 9
    expect(chromeFuriganaPx(18)).toBe(9); // title-sm: exactly 9
    expect(chromeFuriganaPx(22)).toBe(11); // title: half
    expect(chromeFuriganaPx(28)).toBe(14); // display: half

    // The drawn reading carries that as its own font size, whatever the
    // uniwind stub makes of the class — a native Text takes no size from a
    // parent. text-caption (12px) floors to 9.
    const { container } = renderT("ja-furigana", "settings.focusAria", undefined, "text-caption text-muted-foreground");
    const reading = container.querySelector("[style*='font-size']");
    expect(reading?.getAttribute("style")).toMatch(/font-size:\s*9px/);
  });
});

describe("tp (never-drawn strings)", () => {
  function Probe({ k }: { k: StringKey }) {
    const tp = useTp();
    return <span>{tp(k)}</span>;
  }

  it("in furigana mode names the string plain, readings left out", () => {
    const { getByText } = render(
      <InterfaceLanguageProvider language="ja-furigana" setLanguage={() => undefined}>
        <Probe k="settings.focusAria" />
      </InterfaceLanguageProvider>,
    );
    expect(getByText("重点項目")).toBeTruthy();
  });
});

describe("labelAria", () => {
  function Names({ label }: { label: ReactNode }) {
    const tp = useTp();
    return <span data-testid="name">{labelAria(label, tp) ?? "(none)"}</span>;
  }

  it("takes a plain string label as its own name", () => {
    const { getByTestId } = render(<Names label="Server" />);
    expect(getByTestId("name").textContent).toBe("Server");
  });

  it("names a control after the table entry its label draws", () => {
    const { getByTestId } = render(
      <InterfaceLanguageProvider language="ja-furigana" setLanguage={() => undefined}>
        <Names label={<T k="settings.focusAria" />} />
      </InterfaceLanguageProvider>,
    );
    // The plain Japanese, not the drawn furigana.
    expect(getByTestId("name").textContent).toBe("重点項目");
  });
});
