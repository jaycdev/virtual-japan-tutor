import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Login } from "./Login.tsx";

// The signed-out screen in its new shell: wordmark + title, the fields and
// button the auth logic already exposes (Username / Password / "Log in"), and
// the server-address control that Android needs to point at a LAN server.
// The web build infers the address from the page origin, so it gets no field.
function login(props: Partial<Parameters<typeof Login>[0]> = {}) {
  render(
    <Login
      busy={false}
      error={undefined}
      serverUrl="http://192.168.1.10:8080"
      onLogin={vi.fn()}
      onSaveServerUrl={vi.fn(async () => {})}
      {...props}
    />,
  );
}

describe("Login", () => {
  test("shows the wordmark, the fields, and the log-in button", () => {
    login();
    expect(screen.getByText("読")).toBeTruthy();
    expect(screen.getByText("Virtual Japan Tutor")).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  test("submits the typed credentials", () => {
    const onLogin = vi.fn();
    login({ onLogin });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "learner" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    screen.getByRole("button", { name: "Log in" }).click();
    expect(onLogin).toHaveBeenCalledWith("learner", "hunter2");
  });

  test("surfaces a login error and keeps the button usable for a retry", () => {
    login({ error: "Wrong username or password" });
    expect(screen.getByText("Wrong username or password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  test("disables the button while a login is in flight", () => {
    login({ busy: true });
    expect(screen.getByRole("button", { name: "Log in" }).hasAttribute("disabled")).toBe(true);
  });
});
