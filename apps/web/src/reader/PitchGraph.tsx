import type { PitchPattern } from "@vjt/api-client";
import { pitchDots, translatePlain, type InterfaceLanguage } from "@vjt/core";

/**
 * The mora pitch graph (ui-plan 4.1): inline SVG drawn with `currentColor`, so the
 * `text-pitch` class on the svg paints it in the pitch colour in both themes. The
 * dot geometry is shared with the phone graph (pitchDots in @vjt/core).
 */
export function PitchGraph({
  pitch,
  width = 88,
  height = 36,
}: {
  pitch: PitchPattern;
  width?: number;
  height?: number;
}) {
  const dots = pitchDots(pitch, width, height);
  return (
    <svg
      data-testid="pitch-graph"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-pitch"
    >
      {dots.map((d, i) => {
        const prev = dots[i - 1];
        if (!prev) return null;
        return <line key={`seg-${i}`} x1={prev.x} y1={prev.y} x2={d.x} y2={d.y} stroke="currentColor" strokeWidth={1.5} />;
      })}
      {dots.map((d, i) => (
        <circle key={`dot-${i}`} cx={d.x} cy={d.y} r={4} fill="currentColor" />
      ))}
    </svg>
  );
}

/** The caption the graph carries: the pattern spelled out in the Interface Language. */
export function pitchCaption(pitch: PitchPattern, lang: InterfaceLanguage = "en"): string {
  const base = pitch.heiban
    ? translatePlain(lang, "reader.pitchHeiban")
    : translatePlain(lang, "reader.pitchDownstep", { n: pitch.downstepAfterMora });
  return pitch.tag ? `${base} — ${pitch.tag}` : base;
}
