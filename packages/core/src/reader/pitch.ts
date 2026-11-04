import type { PitchPattern } from "@vjt/api-client";

export interface PitchDot {
  x: number;
  y: number;
}

/**
 * The dots of the mora pitch graph (issue #14), in a box of `width` by
 * `height`: one dot per mora plus a trailing dot for what happens after the
 * last mora. A mora is high while it sits before the downstep; heiban keeps
 * every mora high, and so does the trailing dot. Both apps draw the segments
 * and dots from these coordinates (mobile with react-native-svg, web inline SVG).
 */
export function pitchDots(pitch: PitchPattern, width: number, height: number, pad = 10): PitchDot[] {
  const yHigh = 8;
  const yLow = height - 12;
  const n = pitch.moraCount + 1;
  const step = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const isHigh = (mora: number) => mora < pitch.downstepAfterMora;
  return Array.from({ length: n }, (_, i) => {
    const high = i < pitch.moraCount ? isHigh(i + 1) : pitch.heiban;
    return { x: pad + step * i, y: high ? yHigh : yLow };
  });
}
