import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TEST_PASSWORD, TEST_USER, currentLocation, renderAppAt } from "../test/renderApp.tsx";

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
});
