import type { PitchPattern } from "@vjt/api-client";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

/**
 * The mora pitch graph (issue #14), drawn from the Kanjium PitchPattern the
 * lookup returns: one dot per mora plus a trailing dot showing what happens
 * after the last mora, at two levels — high or low — with the drop where
 * Kanjium says the downstep falls. Draws real SVG through react-native-svg on
 * Android; the jsdom tests stub the shapes out (test/react-native-svg-stub).
 * The strokes use `currentColor`, so the theme text colour (set by
 * `text-pitch` on the wrapper) paints the graph on both hosts.
 */
export function PitchGraph({
  pitch,
  width = 88,
  withCaption = false,
}: {
  pitch: PitchPattern;
  width?: number;
  /** Spell the pattern out ("heiban (flat)") instead of the compact glyph. */
  withCaption?: boolean;
}) {
  const height = 36;
  const pad = 10;
  const yHigh = 8;
  const yLow = height - 12;
  const n = pitch.moraCount + 1; // mora dots plus the trailing dot
  const step = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  // A mora is high while it sits before the downstep; heiban (downstep after
  // the end) keeps every mora high, and so does the trailing dot.
  const isHigh = (mora: number) => mora < pitch.downstepAfterMora;
  const trailingHigh = pitch.heiban;

  const dots = Array.from({ length: n }, (_, i) => {
    const high = i < pitch.moraCount ? isHigh(i + 1) : trailingHigh;
    return { x: pad + step * i, y: high ? yHigh : yLow };
  });
  return (
    <View
      testID="pitch-graph"
      className="text-pitch"
      style={styles.wrap}
      accessibilityLabel={`Pitch: ${pitch.heiban ? "heiban" : `accent ${pitch.accentPosition}`}`}
    >
      <Svg width={width} height={height} aria-hidden className="text-pitch">
        {dots.map((d, i) => {
          const prev = dots[i - 1];
          if (!prev) return null;
          return (
            <Line key={`seg-${i}`} x1={prev.x} y1={prev.y} x2={d.x} y2={d.y} stroke="currentColor" strokeWidth={1.5} />
          );
        })}
        {dots.map((d, i) => (
          <Circle key={`dot-${i}`} cx={d.x} cy={d.y} r={4} fill="currentColor" />
        ))}
      </Svg>
      <Text className={withCaption ? "text-small text-muted-foreground" : "text-caption text-muted-foreground"}>
        {withCaption
          ? pitch.heiban
            ? "heiban (flat)"
            : `downstep after mora ${pitch.downstepAfterMora}`
          : pitch.heiban
            ? "へ"
            : `↓${pitch.accentPosition}`}
        {pitch.tag ? ` ${pitch.tag}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 4 },
});
