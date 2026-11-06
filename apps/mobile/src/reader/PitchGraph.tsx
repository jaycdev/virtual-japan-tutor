import type { PitchPattern } from "@vjt/api-client";
import { pitchDots, useT } from "@vjt/core";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

import { TableText } from "../components/Text.tsx";

// Compact notation for the graph, not interface copy: the heiban kana and the
// downstep arrow read the same whatever the Learner's Interface Language is.
const HEIBAN_GLYPH = "へ";

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
  const { t, tp } = useT();
  // The dot geometry is shared with the web graph (issue #77, @vjt/core).
  const dots = pitchDots(pitch, width, height);
  const spelled = pitch.heiban ? t("reader.pitchHeiban") : t("reader.pitchDownstep", { n: pitch.downstepAfterMora });
  return (
    <View
      testID="pitch-graph"
      className="text-pitch"
      style={styles.wrap}
      accessibilityLabel={pitch.heiban ? tp("reader.pitchAriaHeiban") : tp("reader.pitchAriaAccent", { n: pitch.accentPosition })}
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
      {withCaption ? (
        <TableText
          className="text-small text-muted-foreground"
          segments={pitch.tag ? [...spelled, { text: ` ${pitch.tag}` }] : spelled}
        />
      ) : (
        <Text className="text-caption text-muted-foreground">
          {pitch.heiban ? HEIBAN_GLYPH : `↓${pitch.accentPosition}`}
          {pitch.tag ? ` ${pitch.tag}` : ""}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 4 },
});
