import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { interfaceLanguageStore } from "../interfacelanguage/index.tsx";
import { unrubyfiedKanji } from "../test/kanjiCoverage.ts";
import { TEST_PASSWORD, TEST_USER, currentLocation, renderAppAt } from "../test/renderApp.tsx";

afterEach(() => {
  // The store outlives one render; a switched login page must not leave the
  // next test in Japanese (issue #125).
  interfaceLanguageStore.setLanguage("en");
});

describe("Login", () => {
  it("shows the wordmark, the two fields and a disabled Log in until both are filled", async () => {
    const user = userEvent.setup();
    renderAppAt("/login", { signedIn: false });

    expect(await screen.findByRole("heading", { name: "Virtual Japan Tutor" })).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Log in" });
    expect(submit).toHaveProperty("disabled", true);

    await user.type(screen.getByLabelText("Username"), TEST_USER.username);
    expect(submit).toHaveProperty("disabled", true);
    await user.type(screen.getByLabelText("Password"), TEST_PASSWORD);
    expect(submit).toHaveProperty("disabled", false);
  });

  it("masks the password", async () => {
    renderAppAt("/login", { signedIn: false });
    expect((await screen.findByLabelText("Password")).getAttribute("type")).toBe("password");
  });

  it("shows a wrong-password error inline and stays on the page", async () => {
    const user = userEvent.setup();
    const { router } = renderAppAt("/login", { signedIn: false });

    await user.type(await screen.findByLabelText("Username"), TEST_USER.username);
    await user.type(screen.getByLabelText("Password"), "not the password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Wrong username or password.");
    expect(currentLocation(router)).toBe("/login");
  });

  it("submits with Enter from the password field", async () => {
    const user = userEvent.setup();
    const { router } = renderAppAt("/login?next=%2Fpractice", { signedIn: false });

    await user.type(await screen.findByLabelText("Username"), TEST_USER.username);
    await user.type(screen.getByLabelText("Password"), `${TEST_PASSWORD}{Enter}`);

    await waitFor(() => expect(currentLocation(router)).toBe("/practice"));
  });

  it("sends an already signed-in visitor straight on", async () => {
    const { router } = renderAppAt("/login?next=%2Fgrammar", { signedIn: true });
    await waitFor(() => expect(currentLocation(router)).toBe("/grammar"));
  });

  // Issue #125: the language is device-saved, so the login card can already switch it.
  it("switches its own labels with the compact language choice", async () => {
    const user = userEvent.setup();
    renderAppAt("/login", { signedIn: false });

    // One compact row, the legend now the group's accessible name.
    expect(await screen.findByRole("group", { name: "Interface language" })).toBeTruthy();

    await user.click(await screen.findByRole("button", { name: "日本語" }));

    expect(await screen.findByLabelText("ユーザー名")).toBeTruthy();
    expect(screen.getByLabelText("パスワード")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
    // The label names itself in every language.
    expect(screen.getByRole("button", { name: "English" })).toBeTruthy();
    await waitFor(() => expect(document.documentElement.lang).toBe("ja"));

    await user.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByLabelText("Username")).toBeTruthy();
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });

  it("the login card in ja-furigana keeps its chrome inside ruby", async () => {
    const user = userEvent.setup();
    const { container } = renderAppAt("/login", { signedIn: false });

    await user.click(await screen.findByRole("button", { name: "日本語（ふりがな）" }));

    // ログイン uses no kanji, but the username label does — it must arrive as
    // ruby, not bare text. (findByLabelText would include the <rt> in the
    // accessible name, so wait on the markup itself.)
    await waitFor(() => expect(container.querySelectorAll("ruby").length).toBeGreaterThan(0));
    expect(unrubyfiedKanji(container)).toEqual([]);
  });
});
