// Practice key scoping, focus timing and accessible names (review of PR #87).
// Kept apart from Practice.test.tsx: these cases need a page with outside
// controls (a link, an input, a nav sheet) around the screen.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation } from "react-router";
import { createApiClient } from "@vjt/api-client";

import { Button } from "../components/ui/button.tsx";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../components/ui/sheet.tsx";
import { Practice } from "./Practice.tsx";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function session(answered: string | null, chosen: string | null = null) {
  const exercises = [
    { id: "ex-1", kind: "recognition", instruction: "What does this mean?", prompt: "学", options: [
      { id: "o-learn", text: "learn" },
      { id: "o-tree", text: "tree" },
    ] },
    { id: "ex-2", kind: "recognition", instruction: "What does this mean?", prompt: "水", options: [
      { id: "o-water", text: "water" },
      { id: "o-tree", text: "tree" },
    ] },
  ];
  return {
    id: "practice-1",
    state: "active",
    targetSize: 2,
    skipped: 0,
    exercises: exercises.map((ex) => ({
      ...ex,
      answered: ex.id === answered,
      ...(ex.id === answered ? { chosenOptionId: chosen, correctOptionId: "o-learn", correct: chosen === "o-learn" } : {}),
    })),
  };
}

/** Stub API: one session on ex-1 (learn is right, tree is wrong), answers recorded in posts. */
function makeFetch(posts: string[]) {
  let answered: string | null = null;
  let chosen: string | null = null;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/practice/sessions") {
      posts.push(path);
      answered = null;
      chosen = null;
      return jsonResponse(session(answered));
    }
    if (request.method === "POST" && path.endsWith("/answers")) {
      posts.push(path);
      const body = (await request.json()) as { optionId: string };
      answered = "ex-1";
      chosen = body.optionId;
      return jsonResponse({ correct: chosen === "o-learn", correctOptionId: "o-learn" });
    }
    if (request.method === "GET") return jsonResponse(session(answered, chosen));
    return jsonResponse({ message: "unexpected" }, 500);
  };
}

// A span, not <output>: an output element carries role=status and would
// collide with the screen's own live region in queries.
function Where() {
  const location = useLocation();
  return <span aria-label="Current location">{location.pathname}</span>;
}

/** The screen with controls that live outside it: a link, a text field, and a nav sheet. */
function PageWithOutsideControls({ posts }: { posts: string[] }) {
  const [, setOpened] = useState(false);
  return (
    <MemoryRouter initialEntries={["/practice"]}>
      <nav>
        <Link to="/stories">Outside link</Link>
        <Sheet onOpenChange={setOpened}>
          <SheetTrigger asChild>
            <Button variant="outline">Open nav</Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetTitle>Menu</SheetTitle>
            <Button variant="ghost">Sheet action</Button>
          </SheetContent>
        </Sheet>
      </nav>
      <label>
        Outside field <input />
      </label>
      <Where />
      <Practice client={createApiClient({ baseUrl: "http://localhost", fetch: makeFetch(posts) as unknown as typeof fetch })} />
    </MemoryRouter>
  );
}

async function startAndAnswerFirst(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
  await waitFor(() => expect(screen.getByText("Exercise 1 of 2")).toBeTruthy());
  await user.keyboard("1");
  await waitFor(() => expect(screen.getByText("Correct")).toBeTruthy());
}

describe("Practice key scope", () => {
  it("Enter on an outside link navigates and does not continue the session", async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    render(<PageWithOutsideControls posts={posts} />);
    await startAndAnswerFirst(user);

    screen.getByRole("link", { name: "Outside link" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Current location").textContent).toBe("/stories");
    expect(screen.queryByText("Exercise 2 of 2")).toBeNull();
    expect(posts.filter((p) => p.endsWith("/answers"))).toHaveLength(1);
  });

  it("a digit typed in an outside input does not answer the exercise", async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    render(<PageWithOutsideControls posts={posts} />);
    fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
    await waitFor(() => expect(screen.getByText("Exercise 1 of 2")).toBeTruthy());

    const field = screen.getByRole("textbox");
    await user.click(field);
    await user.keyboard("12");

    expect((field as HTMLInputElement).value).toBe("12");
    expect(posts.filter((p) => p.endsWith("/answers"))).toHaveLength(0);
    expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
  });

  it("Enter inside the open nav sheet does not continue the session", async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    render(<PageWithOutsideControls posts={posts} />);
    await startAndAnswerFirst(user);

    await user.click(screen.getByRole("button", { name: "Open nav" }));
    const dialog = await screen.findByRole("dialog");
    const action = screen.getByRole("button", { name: "Sheet action" });
    action.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Enter}");

    expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    expect(screen.queryByText("Exercise 2 of 2")).toBeNull();
    expect(posts.filter((p) => p.endsWith("/answers"))).toHaveLength(1);
  });

  it("modified digits do not answer", async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    render(<PageWithOutsideControls posts={posts} />);
    fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
    await waitFor(() => expect(screen.getByText("Exercise 1 of 2")).toBeTruthy());

    await user.keyboard("{Control>}1{/Control}");
    await user.keyboard("{Meta>}1{/Meta}");

    expect(posts.filter((p) => p.endsWith("/answers"))).toHaveLength(0);
  });
});

describe("Practice focus, names and status", () => {
  it("the option group is named by the instruction and the prompt", async () => {
    const posts: string[] = [];
    render(<PageWithOutsideControls posts={posts} />);
    fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
    await waitFor(() => expect(screen.getByText("Exercise 1 of 2")).toBeTruthy());

    expect(screen.getByRole("group", { name: "What does this mean? 学" })).toBeTruthy();
  });

  it("the verdict is in the live region before focus moves to Continue", async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    const original = HTMLElement.prototype.focus;
    const seen: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (this.textContent === "Continue") {
        seen.push(
          Array.from(document.querySelectorAll('[role="status"]'))
            .map((node) => node.textContent ?? "")
            .join("|"),
        );
      }
      return original.call(this, options);
    });
    try {
      render(<PageWithOutsideControls posts={posts} />);
      fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
      await waitFor(() => expect(screen.getByText("Exercise 1 of 2")).toBeTruthy());
      await user.keyboard("2");

      await waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(seen[0]).toContain("Not quite. Correct answer: learn");
    } finally {
      spy.mockRestore();
    }
  });

  it("the starting status is one region that stays mounted and changes its text", async () => {
    const posts: string[] = [];
    const fetchStub = makeFetch(posts);
    let release: (r: Response) => void = () => undefined;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const client = createApiClient({
      baseUrl: "http://localhost",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method === "POST" && new URL(request.url).pathname === "/practice/sessions") return held;
        return fetchStub(input, init);
      }) as unknown as typeof fetch,
    });
    render(
      <MemoryRouter>
        <Practice client={client} />
      </MemoryRouter>,
    );
    const region = screen.getByTestId("practice-status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
    await waitFor(() => expect(screen.getByTestId("practice-status").textContent).toContain("Building your session"));
    expect(screen.getByTestId("practice-status")).toBe(region);

    release(jsonResponse(session(null)));
    await waitFor(() => expect(screen.getByText("Exercise 1 of 2")).toBeTruthy());
    expect(region.textContent).toBe("");
  });
});
