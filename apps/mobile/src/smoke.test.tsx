import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button, Switch, Text, TextInput } from "react-native";
import { useState } from "react";

afterEach(cleanup);

describe("react-native-web test harness", () => {
  it("renders Button/Text and fires onPress", () => {
    let pressed = 0;
    render(<Button title="Tap me" onPress={() => (pressed += 1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Tap me" }));
    expect(pressed).toBe(1);
  });

  it("Button disabled maps to the disabled attribute", () => {
    render(<Button title="Off" disabled onPress={() => undefined} />);
    expect((screen.getByRole("button", { name: "Off" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("TextInput takes change events through onChangeText", () => {
    function Field() {
      const [value, setValue] = useState("");
      return (
        <>
          <TextInput accessibilityLabel="Name" value={value} onChangeText={setValue} />
          <Text>echo: {value}</Text>
        </>
      );
    }
    render(<Field />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ねこ" } });
    expect(screen.getByText("echo: ねこ")).toBeTruthy();
  });

  it("Switch renders a checkbox-like control", () => {
    render(<Switch accessibilityLabel="Boosting" value={false} onValueChange={() => undefined} />);
    expect(screen.getByRole("switch", { name: "Boosting" })).toBeTruthy();
  });
});
