import { View } from "react-native";
import type { ViewProps } from "react-native";

// react-native-svg draws through the native view manager and requires the real
// `react-native` host at import time, which jsdom never sees. The tests only
// care that a pitch graph is present, so the drawings become inert views while
// the surrounding Text still renders.
const SHAPE_ATTRS = new Set(["x1", "y1", "x2", "y2", "cx", "cy", "r", "stroke", "strokeWidth", "fill"]);

function asViewProps(props: ViewProps & Record<string, unknown>): ViewProps {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!SHAPE_ATTRS.has(key)) kept[key] = value;
  }
  return kept as ViewProps;
}

export function Svg(props: ViewProps & { width?: number | string; height?: number | string }) {
  const { width, height, ...rest } = props;
  return <View accessibilityRole="image" {...asViewProps(rest)} style={{ width, height, ...rest.style }} />;
}

export function Circle(props: ViewProps & Record<string, unknown>) {
  return <View {...asViewProps(props)} />;
}

export function Line(props: ViewProps & Record<string, unknown>) {
  return <View {...asViewProps(props)} />;
}

export function Path(props: ViewProps & Record<string, unknown>) {
  return <View {...asViewProps(props)} />;
}

export function Polygon(props: ViewProps & Record<string, unknown>) {
  return <View {...asViewProps(props)} />;
}

export function Polyline(props: ViewProps & Record<string, unknown>) {
  return <View {...asViewProps(props)} />;
}

export function Rect(props: ViewProps & Record<string, unknown>) {
  return <View {...asViewProps(props)} />;
}

export function G(props: ViewProps & Record<string, unknown>) {
  return <View {...asViewProps(props)} />;
}

export default Svg;
