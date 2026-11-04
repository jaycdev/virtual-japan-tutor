import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PortalHost } from "@rn-primitives/portal";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";

// Issue #43: prove the vitest + react-native-web harness can render a
// real React Native Reusables component (copied into components/ui by the
// RNR CLI, Uniwind flavour). The stubs in vitest.config.mts stand in for the
// native-only hosts (reanimated, screens, Uniwind itself); the component and
// its @rn-primitives behaviour render for real.
describe("React Native Reusables under react-native-web", () => {
  afterEach(cleanup);

  it("renders an RNR Button with its label and fires onPress", () => {
    let pressed = 0;
    render(
      <Button variant="outline" onPress={() => (pressed += 1)}>
        <Text>はじめる</Text>
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "はじめる" }));
    expect(pressed).toBe(1);
  });

  it("opens an RNR Dialog from its trigger", () => {
    render(
      <>
        <PortalHost />
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <Text>物語を開く</Text>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>日本語のタイトル</DialogTitle>
              <DialogDescription>Serif body.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </>,
    );
    expect(screen.queryByText("日本語のタイトル")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "物語を開く" }));
    expect(screen.getByText("日本語のタイトル")).toBeTruthy();
  });
});
