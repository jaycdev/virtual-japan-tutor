import "../global.css";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { PortalHost } from "@rn-primitives/portal";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Circle, Path, Svg } from "react-native-svg";
import { Uniwind, useUniwind, withUniwind } from "uniwind";

import { SANS, SANS_BOLD, SERIF, SERIF_BOLD, trialFonts } from "./fonts.ts";
import { loadThemeChoice, saveThemeChoice, type ThemeChoice } from "./themeStore.ts";

/**
 * THROWAWAY (issue #42): a spike screen that exercises the planned stack on
 * our exact versions — Uniwind + React Native Reusables (Button, Dialog,
 * Popover, Dropdown Menu), expo-font with bundled Noto JP fonts, theme
 * switching with Uniwind.setTheme + per-device persistence, and a
 * react-native-svg path themed through withUniwind. Reached only via
 * EXPO_PUBLIC_TRIAL=1 in index.ts. #43 replaces all of this with the real
 * foundations; do not build on it.
 */

// react-native-svg components take `fill`/`stroke` props, not style; the
// withUniwind mapping extracts the themed colour from a Tailwind accent-*
// class and hands it to the prop (Uniwind docs: SVG stroke and fill).
const ThemedPath = withUniwind(Path, {
  fill: { fromClassName: "fillClassName", styleProperty: "accentColor" },
  stroke: { fromClassName: "strokeClassName", styleProperty: "accentColor" },
});
const ThemedCircle = withUniwind(Circle, {
  fill: { fromClassName: "fillClassName", styleProperty: "accentColor" },
});

const THEMES: { choice: ThemeChoice; label: string }[] = [
  { choice: "light", label: "Light" },
  { choice: "dark", label: "Dark" },
  { choice: "system", label: "System" },
];

function pickTheme(choice: ThemeChoice) {
  Uniwind.setTheme(choice);
  void saveThemeChoice(choice);
}

function ThemeRow() {
  const { theme, hasAdaptiveThemes } = useUniwind();
  const current: ThemeChoice = hasAdaptiveThemes ? "system" : theme;
  return (
    <View style={styles.rowWrap}>
      {THEMES.map((t) => (
        <Button
          key={t.choice}
          testID={`theme-${t.choice}`}
          variant={current === t.choice ? "default" : "outline"}
          className="mr-2"
          onPress={() => pickTheme(t.choice)}
        >
          <Text>{t.label}</Text>
        </Button>
      ))}
      <Text className="text-muted-foreground">current: {current}</Text>
    </View>
  );
}

function PitchSample() {
  // Same shape idea as src/reader/PitchGraph.tsx: the stroke/fill follow the
  // themed `pitch` colour via withUniwind, not a hardcoded hex.
  return (
    <Svg width={140} height={64} viewBox="0 0 140 64" accessibilityLabel="pitch sample">
      <ThemedPath
        d="M12 52 L52 22 L92 34 L128 12"
        strokeClassName="accent-pitch"
        fillClassName="accent-transparent"
        strokeWidth={2}
      />
      <ThemedCircle cx={12} cy={52} r={4} fillClassName="accent-pitch" />
      <ThemedCircle cx={52} cy={22} r={4} fillClassName="accent-pitch" />
      <ThemedCircle cx={92} cy={34} r={4} fillClassName="accent-pitch" />
      <ThemedCircle cx={128} cy={12} r={4} fillClassName="accent-pitch" />
    </Svg>
  );
}

function OverlaySamples() {
  return (
    <View style={styles.rowWrap}>
      <Dialog>
        <DialogTrigger asChild>
          <Button>
            <Text>Open Dialog</Text>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>物語</DialogTitle>
            <DialogDescription>
              Dialog content in the serif reading font.
            </DialogDescription>
          </DialogHeader>
          <Text style={{ fontFamily: SERIF, fontSize: 18 }}>
            日本語の本文をこの中で読みます。
          </Text>
        </DialogContent>
      </Dialog>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="ml-2">
            <Text>Open Popover</Text>
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Text style={{ fontFamily: SANS }}>Popover sample — 辞書</Text>
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="ml-2">
            <Text>Menu</Text>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Token menu</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Text>辞書を引く</Text>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Text> Focus Set に追加</Text>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Text>削除</Text>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

export function Trial() {
  // Theme bootstrap lives inside the root because registration in index.ts
  // must be synchronous on Android (see the note there). Render nothing until
  // the saved choice is applied, so the first visible paint is already themed.
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    loadThemeChoice()
      .then((saved) => {
        if (saved) Uniwind.setTheme(saved);
      })
      .catch(() => undefined)
      .finally(() => setThemeReady(true));
  }, []);

  if (!themeReady) return null;
  return (
    <SafeAreaProvider>
      <TrialContent />
      <PortalHost />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

function TrialContent() {
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts(trialFonts);

  return (
    <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
      >
        <Text className="text-foreground text-2xl font-bold">Uniwind + RNR spike</Text>
        <Text className="text-muted-foreground">
          throwaway trial for issue #42 — flag EXPO_PUBLIC_TRIAL=1
        </Text>

        <Text className="text-foreground mt-4 text-base font-semibold">Theme</Text>
        <ThemeRow />

        <Text className="text-foreground mt-4 text-base font-semibold">Buttons</Text>
        <View style={styles.rowWrap}>
          <Button>
            <Text>Primary</Text>
          </Button>
          <Button variant="outline" className="ml-2">
            <Text>Outline</Text>
          </Button>
          <Button variant="destructive" className="ml-2">
            <Text>削除</Text>
          </Button>
        </View>

        <Text className="text-foreground mt-4 text-base font-semibold">Overlays</Text>
        <OverlaySamples />

        <Text className="text-foreground mt-4 text-base font-semibold">
          SVG follows theme (pitch colour)
        </Text>
        <PitchSample />

        <Text className="text-foreground mt-4 text-base font-semibold">Fonts</Text>
        {fontsLoaded ? (
          <View style={styles.gap}>
            <Text style={{ fontFamily: SANS, fontSize: 16 }} className="text-foreground">
              Interface: Noto Sans JP — 日本語のインターフェース
            </Text>
            <Text style={{ fontFamily: SANS_BOLD, fontSize: 16 }} className="text-foreground">
              Bold: Noto Sans JP 700 — 太字
            </Text>
            <Text style={{ fontFamily: SERIF, fontSize: 21 }} className="text-foreground">
              Story: Noto Serif JP — 物語の本文
            </Text>
            <Text style={{ fontFamily: SERIF_BOLD, fontSize: 21 }} className="text-foreground">
              漢字グリフ比較: 直 門 午 骨 冊 毎
            </Text>
          </View>
        ) : (
          <Text className="text-muted-foreground">Loading fonts…</Text>
        )}
      </ScrollView>
  );
}

const styles = StyleSheet.create({
  rowWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 8 },
  gap: { gap: 8 },
});
