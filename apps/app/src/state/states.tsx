// Shared loading/empty/error/progress primitives (issue #44).
//
// Styled purely with design-token utility classes (no palette literals): the
// Today screen (#47), Story reader work (#48) and Grammar (#50) all compose
// these, so the states look the same everywhere.

import { Pressable, Text, View } from "react-native";

/**
 * One shimmering placeholder bar. Exported so a screen can lay its skeleton
 * out like the content that will replace it — a title bar, a meta bar, a
 * button block — instead of a generic stack of lines (issue #47 review S7).
 */
export function SkeletonBar({
  width,
  height,
}: {
  /** px, or a percentage string. */
  width: number | string;
  height: number;
}) {
  return (
    <View
      // Hidden from screen readers on both hosts: the RN prop plus
      // importantForAccessibility, whose descendants RNW keeps out of the
      // a11y tree the way Android does.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="animate-pulse rounded-md bg-muted"
      style={{ width, height }}
    />
  );
}

/** A shimmering placeholder block while content loads. */
export function Skeleton({
  lines = 3,
  lineHeight = 16,
}: {
  lines?: number;
  /** Height of each line in px; the last line is half width. */
  lineHeight?: number;
}) {
  return (
    <View className="gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBar
          key={i}
          width={i === lines - 1 && lines > 1 ? "60%" : "100%"}
          height={lineHeight}
        />
      ))}
    </View>
  );
}

/**
 * Nothing to show yet: one calm line and exactly one action (issue #44 spec —
 * EmptyState never grows a paragraph or two buttons).
 *
 * `compact` drops the 24 px of padding for the common case of an EmptyState
 * already sitting inside a Card, which brings its own 20 px of it — the two
 * stacks read as one oversized margin (issue #47 review S8).
 */
export function EmptyState({
  message,
  actionLabel,
  onAction,
  compact = false,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** For use inside a card or other already-padded surface. */
  compact?: boolean;
}) {
  return (
    <View className={`${compact ? "" : "p-6 "}flex-1 items-center justify-center gap-3`}>
      <Text className="text-center text-body text-muted-foreground">{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          className="min-h-11 justify-center rounded-lg border border-primary px-4 active:bg-accent"
        >
          <Text className="text-body font-semibold text-primary">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A failure in place, with one Retry action. */
export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View
      accessibilityRole="alert"
      role="alert"
      className="min-h-11 flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive p-3"
    >
      <Text className="flex-1 text-body text-destructive">{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry"
        onPress={onRetry}
        className="min-h-11 justify-center rounded-md bg-destructive px-4 active:opacity-80"
      >
        <Text className="text-body font-semibold text-destructive-foreground">Retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * Progress as a bar plus one status line underneath (issue #44 spec): the bar
 * carries no text of its own, the caption says what is happening.
 */
export function ProgressBar({
  value,
  label,
}: {
  /** 0–1; values outside that range are clamped. */
  value: number;
  /** The status line under the bar. */
  label: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View className="gap-2">
      <View
        // RN semantics for native, plain ARIA props for react-native-web
        // (this RNW build maps `role`/`aria-*`, not the accessibilityValue
        // bridge) — same bar, both hosts.
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <View className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </View>
      <Text className="text-caption text-muted-foreground">{label}</Text>
    </View>
  );
}
