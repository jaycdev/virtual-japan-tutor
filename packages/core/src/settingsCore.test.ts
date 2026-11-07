import { describe, expect, it } from "vitest";

import { canSubmitProviderForm, isProviderFormTouched, providerCreateInput, providerUpdateInput, EMPTY_PROVIDER_FORM } from "./aiProviderForm.ts";
import { isSavedList, itemListHint } from "./itemLists.ts";
import { probeServerHealth } from "./serverHealth.ts";
import { findSettingsSection, SETTINGS_SECTIONS } from "./settingsSections.ts";
import { parseLookupHold, suggestionsFor } from "./settingsText.ts";

describe("settings sections", () => {
  it("keeps the plan's order and the route slugs other screens link to", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "appearance",
      "reading",
      "stories",
      "lists",
      "level",
      "marumori",
      "ai",
      "server",
    ]);
    expect(findSettingsSection("lists")?.title).toBe("Item Lists");
    expect(findSettingsSection("nope")).toBeUndefined();
  });
});

describe("AI provider form", () => {
  const filled = { ...EMPTY_PROVIDER_FORM, name: "Local", baseUrl: "http://localhost:11434", model: "llama3" };

  it("is untouched until something is typed, and needs name, base URL and model to submit", () => {
    expect(isProviderFormTouched(EMPTY_PROVIDER_FORM)).toBe(false);
    expect(canSubmitProviderForm({ ...EMPTY_PROVIDER_FORM, name: "Local" })).toBe(false);
    expect(canSubmitProviderForm(filled)).toBe(true);
    expect(isProviderFormTouched({ ...EMPTY_PROVIDER_FORM, apiKey: "  " })).toBe(false);
  });

  it("leaves the key out of a create body when none is typed", () => {
    expect(providerCreateInput(filled)).toEqual({ name: "Local", baseUrl: "http://localhost:11434", model: "llama3" });
    expect(providerCreateInput({ ...filled, apiKey: " sk-1 " })).toMatchObject({ apiKey: "sk-1" });
  });

  it("keeps the stored key on update unless the key is typed or removed", () => {
    expect(providerUpdateInput(filled)).not.toHaveProperty("apiKey");
    expect(providerUpdateInput({ ...filled, apiKey: "sk-2" })).toMatchObject({ apiKey: "sk-2" });
    expect(providerUpdateInput({ ...filled, apiKey: "sk-2", removeKey: true })).toMatchObject({ apiKey: null });
  });
});

describe("item lists", () => {
  it("treats the built-in Saved list as protected, whatever its case", () => {
    expect(isSavedList({ name: "SAVED" })).toBe(true);
    expect(isSavedList({ name: "food" })).toBe(false);
  });

  it("describes the default, count and boosting in one hint", () => {
    expect(itemListHint({ isDefault: true, itemCount: 1, boosting: true })).toBe("default · 1 item · boosting");
    expect(itemListHint({ isDefault: false, itemCount: 0, boosting: false })).toBe("0 items");
  });
});

describe("settings text rules", () => {
  it("accepts whole milliseconds from 0 to 10000 and nothing else", () => {
    expect(parseLookupHold("0")).toEqual({ ok: true, ms: 0 });
    expect(parseLookupHold("10000")).toEqual({ ok: true, ms: 10000 });
    expect(parseLookupHold("")).toMatchObject({ ok: false });
    expect(parseLookupHold("10001")).toMatchObject({ ok: false });
    expect(parseLookupHold("1.5")).toMatchObject({ ok: false });
  });

  it("filters suggestions by typed text, and shows the full list only once focused", () => {
    const options = ["travel", "mystery", "romance"];
    expect(suggestionsFor(options, "", false)).toEqual({ show: false, visible: options });
    expect(suggestionsFor(options, "", true).show).toBe(true);
    expect(suggestionsFor(options, "MYS", false)).toEqual({ show: true, visible: ["mystery"] });
    expect(suggestionsFor(options, "zzz", true).show).toBe(false);
  });
});

describe("probeServerHealth", () => {
  it("accepts any 2xx answer, degraded included", async () => {
    await expect(probeServerHealth("http://a", async () => ({ ok: true, status: 200 }))).resolves.toBeUndefined();
    await expect(probeServerHealth("http://a", async () => ({ ok: true, status: 204 }))).resolves.toBeUndefined();
  });

  it("refuses an answer that is not a healthy /health, with the status", async () => {
    const failure = await probeServerHealth("http://a", async () => ({ ok: false, status: 503 }));
    expect(failure).toEqual({ k: "serverHealth.answered", params: { status: 503 } });
  });

  it("refuses an address that does not answer at all", async () => {
    const failure = await probeServerHealth("http://a", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(failure).toEqual({ k: "serverHealth.noAnswer" });
  });

  it("probes <base>/health", async () => {
    const seen: string[] = [];
    await probeServerHealth("http://10.0.0.5:8080", async (url) => {
      seen.push(url);
      return { ok: true, status: 200 };
    });
    expect(seen).toEqual(["http://10.0.0.5:8080/health"]);
  });
});
