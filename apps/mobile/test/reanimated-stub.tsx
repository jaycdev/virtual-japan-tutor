import * as React from "react";
import { View } from "react-native";

// Reanimated 4 needs its Babel plugin and native worklet host, which jsdom
// never has. The spike only needs components that pass `entering`/`exiting`
// animation configs to render without animating, so the animation props are
// dropped and Animated views become plain views.
const DROPPED = new Set(["entering", "exiting", "removing", "collapsable"]);

function withoutAnimationProps(props: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!DROPPED.has(key)) kept[key] = value;
  }
  return kept;
}

const chainable: {
  duration: (ms: number) => typeof chainable;
  delay: (ms: number) => typeof chainable;
  reduceMotion: (mode: unknown) => typeof chainable;
  spring: (config?: unknown) => typeof chainable;
  layout: (config?: unknown) => typeof chainable;
} = {
  duration: () => chainable,
  delay: () => chainable,
  reduceMotion: () => chainable,
  spring: () => chainable,
  layout: () => chainable,
};

export const FadeIn = chainable;
export const FadeOut = chainable;
export const ZoomIn = chainable;
export const ZoomOut = chainable;
export const ReduceMotion = { System: 0, Static: 1, Dynamic: 2 };

function AnimatedView(props: Record<string, unknown>) {
  return <View {...(withoutAnimationProps(props) as React.ComponentProps<typeof View>)} />;
}

function createAnimatedComponent(Component: React.ComponentType<Record<string, unknown>>) {
  const Wrapped = React.forwardRef<unknown, Record<string, unknown>>((props, ref) => (
    <Component ref={ref} {...withoutAnimationProps(props)} />
  ));
  Wrapped.displayName = `Animated(${Component.displayName ?? "Component"})`;
  return Wrapped;
}

const Animated = { View: AnimatedView, createAnimatedComponent };
export default Animated;
