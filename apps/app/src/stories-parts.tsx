import type { Story, StoryGenerationProgress, StorySuggestions } from "@vjt/api-client";
import type { StoryGenerationState, StoryLibraryState } from "@vjt/core";
import * as DialogPrimitives from "@rn-primitives/dialog";
import * as DropdownMenuPrimitive from "@rn-primitives/dropdown-menu";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Icon, type IconName } from "./components/ui/icon.tsx";
import { EmptyState, InlineError, ProgressBar, SkeletonBar } from "./state/states.tsx";

/**
 * The pieces of the rebuilt Stories page (issue #48, plan §4.5).
 *
 * The card, the per-card menu, the delete confirmation and the Generate dialog
 * follow the forms the reader already set (issue #45 review): anchored dropdowns
 * on wide windows, sheets pinned to the bottom edge on narrow ones — the same
 * OVERLAY_BREAKPOINT the reader's overlays split at, which the page passes in
 * as `narrow`. Styling is design-token classes only (plan §3): the styles below
 * are geometry (touch sizes, radii, sheet edges), never colour or font size.
 */

/** Story Origin in Learner's words. */
export function originLabel(story: Story): string {
  return story.origin === "on_demand" ? "On demand" : "Automatic";
}

/** The api-client's genre ids in Learner's words; an unknown id shows as-is. */
export function genreLabel(genre: string | null | undefined): string {
  switch (genre) {
    case "diary":
      return "Diary";
    case "travel":
      return "Travel";
    case "mystery":
      return "Mystery";
    case null:
    case undefined:
      return "";
    default:
      return genre;
  }
}

/** The card's date, short and unambiguous: "Nov 1, 2026". */
export function storyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The Learner-facing stage of a generation run, in the pinned card's progress
 * and in the Generate dialog (the same words Today shows).
 */
export function stageLabel(progress: StoryGenerationProgress): string {
  switch (progress.stage) {
    case "preparing":
      return "Preparing…";
    case "writing":
      return progress.attempt != null && progress.maxAttempts != null
        ? `Writing… attempt ${progress.attempt} of ${progress.maxAttempts}`
        : "Writing…";
    case "checking":
      return "Checking it fits your vocabulary…";
    case "saving":
      return "Saving…";
    default:
      return "Writing…";
  }
}

/**
 * The page's action control: 44 px tall and 8 px of radius like every other
 * button (plan §2.5), filled where it is the section's main action and outlined
 * where it is a way in or out. Same shape the Today sections use.
 */
export function ActionButton({
  label,
  onPress,
  filled = false,
  disabled = false,
  fullWidth = false,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  filled?: boolean;
  disabled?: boolean;
  /** Stretches to the column, for the stacked narrow layout. */
  fullWidth?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const shape = filled ? "bg-primary" : "border border-border bg-card";
  const text = filled ? "text-primary-foreground" : "text-foreground";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 flex-row items-center justify-center ${fullWidth ? "w-full" : "self-start"} rounded-md px-4 active:opacity-80 ${shape}${
        disabled ? " opacity-50" : ""
      }`}
    >
      {/* uniwind drops a colour class that precedes a text-size class on native,
          so the size comes first here as everywhere else. */}
      <Text className={`text-body font-semibold ${text}`}>{label}</Text>
    </Pressable>
  );
}

/**
 * A Library card (issue #48): the Story Title with its English translation
 * hidden until revealed, and the Genre / Story Origin / date line with a Read
 * check. The title opens the Story, the translation line reveals on its own
 * tap, and the menu carries Mark Read and delete. No rating thumbs here — the
 * Reader asks for the rating where the Learner has just read the Story.
 */
export function StoryCard({
  story,
  revealed,
  onToggleReveal,
  onOpen,
  menu,
}: {
  story: Story;
  revealed: boolean;
  onToggleReveal: () => void;
  onOpen: () => void;
  /** The StoryMenu, rendered by the caller so the menu owns its open state. */
  menu: ReactNode;
}) {
  return (
    <Card testID={`story-card-${story.id}`}>
      <View className="flex-row items-center gap-1">
        <Pressable
          testID={`story-open-${story.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Open story: ${story.title}`}
          accessibilityHint="Opens the Reader"
          onPress={onOpen}
          style={styles.titlePress}
        >
          <Text className="text-body font-semibold text-foreground" numberOfLines={2}>
            {story.title}
          </Text>
        </Pressable>
        {story.readAt ? (
          <View
            testID={`story-read-${story.id}`}
            className="flex-row items-center gap-1"
            // A plain View is not an element on Android: say what it is and make
            // it one, so the label is actually read out (issue #48, N3).
            accessibilityRole="text"
            accessible
            accessibilityLabel={`Read on ${storyDate(story.readAt)}`}
          >
            {/* The check is the mark; the words spell it out for screen readers
                and for anyone scanning the grid. */}
            <Icon name="check" size="xs" className="text-primary" />
            <Text className="text-caption text-muted-foreground">Read</Text>
          </View>
        ) : null}
        {menu}
      </View>

      {story.titleEn ? (
        <Pressable
          testID={`title-translation-${story.id}`}
          accessibilityRole="button"
          // Hidden: the label names the action, because there is no content to
          // announce. Revealed: no override label — the English itself is what
          // a screen reader should read.
          accessibilityLabel={revealed ? undefined : "Show title translation"}
          accessibilityState={{ expanded: revealed }}
          onPress={onToggleReveal}
          style={styles.translation}
        >
          {/* One reserved line, and the English is not in the tree at all until
              revealed — "invisible text" tricks (transparent colour, CSS blur)
              do not hold on Android. The hint sits in the same slot, so nothing
              shifts and the card never grows when the Learner reveals (B1/B4). */}
          {revealed ? (
            <Text className="text-small text-muted-foreground">{story.titleEn}</Text>
          ) : (
            <Text className="text-caption text-muted-foreground">Title translation hidden — tap to show</Text>
          )}
        </Pressable>
      ) : null}

      <Text className="text-caption text-muted-foreground" testID={`story-meta-${story.id}`}>
        {`${genreLabel(story.genre) || "Story"} · ${originLabel(story)} · ${storyDate(story.createdAt)}`}
      </Text>
    </Card>
  );
}

/**
 * The card's menu: Mark Read / Mark unread, and Delete. Wide windows get an
 * anchored dropdown; narrow windows get the same rows in a Dialog sheet at the
 * bottom edge, where they are thumb-reachable and touch-sized (the TokenMenu
 * split, issue #45 review). The trigger is icon-only, so it carries a label.
 */
export function StoryMenu({
  story,
  narrow,
  onMarkRead,
  onMarkUnread,
  onAskDelete,
}: {
  story: Story;
  narrow: boolean;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onAskDelete: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const label = `Actions for ${story.title}`;

  const trigger = (onPress?: () => void, expanded?: boolean) => (
    <Pressable
      testID={`story-menu-${story.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Mark read, or delete this story"
      accessibilityState={{ expanded: expanded ?? false }}
      onPress={onPress}
      hitSlop={8}
      style={styles.trigger}
      className="rounded-md active:bg-accent"
    >
      <Icon name="menu" size="sm" className="text-muted-foreground" />
    </Pressable>
  );

  const rows = (onPick: (action: () => void) => void, variant: "menu" | "sheet") => (
    <>
      <MenuRow
        variant={variant}
        testID="menu-mark-read"
        label={story.readAt ? "Mark unread" : "Mark read"}
        icon={story.readAt ? "close" : "check"}
        onPress={() => onPick(story.readAt ? onMarkUnread : onMarkRead)}
      />
      <MenuRow
        variant={variant}
        testID="menu-delete"
        label="Delete"
        icon="trash"
        destructive
        onPress={() => onPick(onAskDelete)}
      />
    </>
  );

  if (!narrow) {
    return (
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger asChild>{trigger()}</DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Overlay style={styles.backdrop}>
            <DropdownMenuPrimitive.Content
              testID="story-menu-content"
              accessibilityLabel={label}
              style={styles.menuCard}
              className="bg-card border-border"
              side="bottom"
              align="end"
              sideOffset={4}
            >
              {rows((action) => action(), "menu")}
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Overlay>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
    );
  }

  return (
    <>
      {trigger(() => setSheetOpen(true), sheetOpen)}
      {sheetOpen ? (
        <DialogPrimitives.Root open onOpenChange={(open) => !open && setSheetOpen(false)}>
          <DialogPrimitives.Portal>
            <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
            <DialogPrimitives.Content
              testID="story-menu-sheet"
              style={styles.sheet}
              className="bg-card border-t border-border"
            >
              {/* A labelled surface still needs a title for assistive tech. */}
              <DialogPrimitives.Title style={styles.srOnly}>{label}</DialogPrimitives.Title>
              {rows(
                (action) => {
                  setSheetOpen(false);
                  action();
                },
                "sheet",
              )}
            </DialogPrimitives.Content>
          </DialogPrimitives.Portal>
        </DialogPrimitives.Root>
      ) : null}
    </>
  );
}

/**
 * One menu row. It is used in two places with the same box and the same label,
 * and the caller says which primitive wraps it: inside a DropdownMenu.Content it
 * must itself be an Item so Radix (web) and the primitives (Android) see it as a
 * menu item; in a Dialog sheet it is a plain Pressable row.
 */
function MenuRow({
  variant,
  testID,
  label,
  icon,
  selected = false,
  destructive = false,
  onPress,
}: {
  variant: "menu" | "sheet";
  testID: string;
  label: string;
  icon?: IconName;
  /** The option a Picker currently stands on. */
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  const tone = destructive ? "text-destructive" : "text-foreground";
  const inner = (
    <>
      {icon ? <Icon name={icon} size="sm" className={tone} /> : null}
      <Text className={`text-body ${selected ? "font-semibold text-primary" : tone}`}>{label}</Text>
      {selected ? <Icon name="check" size="sm" className="text-primary" /> : null}
    </>
  );
  if (variant === "menu") {
    return (
      <DropdownMenuPrimitive.Item
        testID={testID}
        // RN Primitives' web Item hands its children straight to Radix, which
        // names the row through role rather than RN's accessibility props.
        role="menuitem"
        accessibilityRole="button"
        onPress={onPress}
        style={styles.item}
        className="rounded-sm active:bg-accent"
      >
        {inner}
      </DropdownMenuPrimitive.Item>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.item}
      className="rounded-sm active:bg-accent"
    >
      {inner}
    </Pressable>
  );
}

/**
 * The delete confirmation (issue #48: delete asks first): it names the Story so
 * nobody deletes a mystery card, and Keep is the calmer neighbour of the
 * destructive action. Bottom sheet on narrow windows, centred card on wide ones
 * — the SaveToSheet geometry.
 */
export function ConfirmDelete({
  narrow,
  viewWidth,
  story,
  pending,
  error,
  onKeep,
  onConfirm,
}: {
  narrow: boolean;
  /** Viewport width: the wide card centres over the content column, not the viewport's 50%. */
  viewWidth: number;
  story: Story;
  pending: boolean;
  error: string | null;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogPrimitives.Root open onOpenChange={(open) => !open && onKeep()}>
      <DialogPrimitives.Portal>
        <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitives.Content
          testID="confirm-delete"
          style={[narrow ? styles.sheet : centeredDialog(viewWidth), styles.dialogBody]}
          className={narrow ? "bg-card border-t border-border" : "bg-card border border-border"}
        >
          <DialogPrimitives.Title asChild>
            <Text className="text-title-sm font-semibold text-foreground">Delete this Story?</Text>
          </DialogPrimitives.Title>
          <DialogPrimitives.Description asChild>
            {/* The non-breaking tie keeps “Practice Records stay.” from orphaning
                a single word at narrow widths; text-balance carries it on web
                where the utility exists. */}
            <Text className="text-small text-muted-foreground text-balance">
              {`“${story.title}” goes away for good, along with its rating.\u00A0Your Practice Records stay.`}
            </Text>
          </DialogPrimitives.Description>
          {error ? (
            <Text accessibilityRole="alert" role="alert" testID="confirm-delete-error" className="text-small text-destructive">
              {error}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable
              testID="confirm-delete-keep"
              accessibilityRole="button"
              accessibilityLabel="Keep"
              onPress={onKeep}
              style={styles.dialogButton}
              className="border border-border bg-card active:opacity-80"
            >
              <Text className="text-body font-semibold text-foreground">Keep</Text>
            </Pressable>
            <Pressable
              testID="confirm-delete-accept"
              accessibilityRole="button"
              accessibilityLabel="Confirm delete"
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={onConfirm}
              style={styles.dialogButton}
              className={`bg-destructive active:opacity-80${pending ? " opacity-50" : ""}`}
            >
              <Text className="text-body font-semibold text-destructive-foreground">Delete</Text>
            </Pressable>
          </View>
        </DialogPrimitives.Content>
      </DialogPrimitives.Portal>
    </DialogPrimitives.Root>
  );
}

/**
 * The Generate dialog (issue #48): an On-demand Story with optional Genre and
 * Theme, taken from the server's suggestions, and the run's progress while it is
 * being written. Closing it never disturbs a run that is already going — the run
 * lives on the server and the pinned card keeps showing its bar.
 */
export function GenerateDialog({
  narrow,
  viewWidth,
  runHere,
  suggestions,
  genre,
  theme,
  onGenreChange,
  onThemeChange,
  generation,
  error,
  onGenerate,
  onClose,
}: {
  narrow: boolean;
  /** Viewport width: the wide card centres over the content column, not the viewport's 50%. */
  viewWidth: number;
  /** Whether a run was started from this dialog in this visit (S2): the only run its words may speak of. */
  runHere: boolean;
  suggestions: StorySuggestions;
  genre: string | null;
  theme: string | null;
  onGenreChange: (genre: string | null) => void;
  onThemeChange: (theme: string | null) => void;
  generation: StoryGenerationState;
  error: string | null;
  onGenerate: () => void;
  onClose: () => void;
}) {
  const running = generation.status === "running";
  // One error line, inside the dialog, and only for a run this dialog started:
  // an old server `failed` must not greet a dialog that has started nothing (S2).
  const failure =
    runHere && generation.status === "failed"
      ? (generation.progress.message ?? "Couldn’t write a Story for you.")
      : null;
  const alert = failure ?? (runHere ? error : null);
  return (
    <DialogPrimitives.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitives.Portal>
        <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitives.Content
          testID="generate-dialog"
          style={[narrow ? styles.sheet : centeredDialog(viewWidth), styles.dialogBody]}
          className={narrow ? "bg-card border-t border-border" : "bg-card border border-border"}
        >
          <DialogPrimitives.Title asChild>
            <Text className="text-title-sm font-semibold text-foreground">Generate a Story</Text>
          </DialogPrimitives.Title>
          <DialogPrimitives.Description asChild>
            <Text className="text-small text-muted-foreground text-balance">
              One new Story now. Genre and Theme are optional — leave them on Any and the tutor chooses.
            </Text>
          </DialogPrimitives.Description>

          <View style={styles.pickerRows}>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-small text-muted-foreground">Genre</Text>
              <Picker
                testID="generate-genre-picker"
                ariaLabel="Genre for this story"
                placeholder="Any genre"
                value={genre}
                options={suggestions.genres}
                onChange={onGenreChange}
              />
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-small text-muted-foreground">Theme</Text>
              <Picker
                testID="generate-theme-picker"
                ariaLabel="Theme for this story"
                placeholder="Any theme"
                value={theme}
                options={suggestions.themes}
                onChange={onThemeChange}
              />
            </View>
          </View>

          {running ? (
            <View testID="generate-progress" style={styles.progress}>
              <ProgressBar
                value={(generation.progress.percent ?? 0) / 100}
                label={`${stageLabel(generation.progress)} ${Math.round(generation.progress.percent ?? 0)}%`}
              />
            </View>
          ) : null}
          {alert ? (
            <Text accessibilityRole="alert" role="alert" testID="generate-error" className="text-small text-destructive">
              {alert}
            </Text>
          ) : null}

          <View style={styles.dialogActions}>
            <Pressable
              testID="generate-cancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={onClose}
              style={styles.dialogButton}
              className="border border-border bg-card active:opacity-80"
            >
              <Text className="text-body font-semibold text-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              testID="generate-confirm"
              accessibilityRole="button"
              accessibilityLabel="Generate"
              accessibilityHint={running ? "A Story is already being written" : "Writes one new Story now"}
              accessibilityState={{ disabled: running }}
              disabled={running}
              onPress={onGenerate}
              style={styles.dialogButton}
              className={`bg-primary active:opacity-80${running ? " opacity-50" : ""}`}
            >
              <Text className="text-body font-semibold text-primary-foreground">Generate</Text>
            </Pressable>
          </View>
        </DialogPrimitives.Content>
      </DialogPrimitives.Portal>
    </DialogPrimitives.Root>
  );
}

/**
 * A dropdown picker over a list of server suggestions: the chip reads as a
 * control, the rows are the menu — the same DropdownMenu the card menu uses, so
 * web gets Radix's keyboard handling for free and Android an anchored popup.
 * The first row is the "Any" choice, which means the field is left out of the
 * request.
 */
export function Picker({
  testID,
  ariaLabel,
  placeholder,
  value,
  options,
  onChange,
}: {
  testID: string;
  ariaLabel: string;
  placeholder: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  // The primitive owns the menu, but reports every open and close here;
  // mirroring that state lets the trigger tell assistive tech what the
  // chevron already tells the eye (issue #48 review, N1).
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenuPrimitive.Root onOpenChange={setOpen}>
      <DropdownMenuPrimitive.Trigger asChild>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${ariaLabel}: ${value ? genreLabel(value) || value : placeholder}`}
          accessibilityState={{ expanded: open }}
          style={styles.picker}
          className="rounded-md border border-border bg-card active:bg-accent"
        >
          <Text className="text-small text-foreground" numberOfLines={1}>
            {value ? genreLabel(value) || value : placeholder}
          </Text>
          <Icon name="chevron-down" size="xs" className="text-muted-foreground" />
        </Pressable>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Overlay style={styles.backdrop}>
          <DropdownMenuPrimitive.Content
            testID={`${testID}-content`}
            accessibilityLabel={ariaLabel}
            style={styles.menuCard}
            className="bg-card border-border"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            <ScrollView style={styles.pickerList}>
              <MenuRow variant="menu" testID={`${testID}-any`} label={placeholder} selected={value === null} onPress={() => onChange(null)} />
              {options.map((option) => (
                <MenuRow
                  key={option}
                  variant="menu"
                  testID={`${testID}-option-${option}`}
                  label={genreLabel(option) || option}
                  selected={option === value}
                  onPress={() => onChange(option)}
                />
              ))}
            </ScrollView>
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Overlay>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

/** A filter chip (Unread | All): the pressed state rides accessibilityState. */
export function FilterChip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.chip}
      // Selection reads as fill + weight, never a heavier border: a 2 px border
      // would change the chip's size the moment it is pressed (issue #48, N2).
      className={`rounded-md px-4 border border-border active:bg-accent ${active ? "bg-accent" : "bg-card"}`}
    >
      <Text className={`text-small ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</Text>
    </Pressable>
  );
}

/** The Library's skeleton, shaped like the cards that replace it (plan §5). */
export function LibrarySkeleton() {
  return (
    <View testID="library-loading" className="gap-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <SkeletonBar width="60%" height={20} />
          <SkeletonBar width="40%" height={14} />
          <SkeletonBar width="50%" height={12} />
        </Card>
      ))}
    </View>
  );
}

/**
 * The Library's empty and error views, plan §5 shaped: one line and one action,
 * and an empty filtered page says so rather than "you have no Stories".
 */
export function LibraryStates({
  library,
  visibleCount,
  filtered,
  onRetry,
  onClearFilters,
  onGenerate,
}: {
  library: StoryLibraryState;
  /** How many of the loaded page the filters left in. */
  visibleCount: number;
  filtered: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
  onGenerate: () => void;
}) {
  if (library.status === "error") {
    return <InlineError message={`Cannot load your library: ${library.message}`} onRetry={onRetry} />;
  }
  if (library.status === "ready" && visibleCount === 0) {
    if (library.page.items.length > 0) {
      return (
        <Card testID="library-empty">
          <EmptyState
            compact
            message="No Stories match these filters."
            actionLabel="Clear filters"
            onAction={onClearFilters}
          />
        </Card>
      );
    }
    return (
      <Card testID="library-empty">
        <EmptyState
          compact
          message={
            filtered
              ? "No Stories yet — and nothing to filter."
              : "No Stories yet. The tutor writes one for you every day, or Generate writes one now."
          }
          actionLabel="Generate a Story"
          onAction={onGenerate}
        />
      </Card>
    );
  }
  return null;
}

/** The pinned Today card's progress block, shared by the page and the dialog. */
export function GenerationProgress({ progress }: { progress: StoryGenerationProgress }) {
  return (
    <View testID="generation-progress" style={styles.progress}>
      <ProgressBar
        value={(progress.percent ?? 0) / 100}
        label={`${stageLabel(progress)} ${Math.round(progress.percent ?? 0)}%`}
      />
      <Text className="text-caption text-muted-foreground">
        It keeps writing if you leave this page.
      </Text>
    </View>
  );
}

// Overlays portal into the primitives' own layer, whose web wrapper is a
// full-viewport fixed div and whose native host is the Shell's PortalHost, so
// `absolute` fills the screen on either host (issue #45 review).
const positioned = { position: "absolute" as const };

const styles = StyleSheet.create({
  titlePress: { flex: 1, minHeight: 44, justifyContent: "center" },
  // One reserved line for the translation (touch-sized): the hint shows in it
  // while hidden, the English replaces the hint on reveal — no jump, no dead line.
  translation: { minHeight: 44, justifyContent: "center" },
  trigger: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  menuCard: {
    minWidth: 200,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    // A shadow reads as a floating card (elevation on Android, the same idea
    // the reader's Lookup menu uses on web).
    elevation: 6,
  },
  item: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    marginHorizontal: 4,
  },
  chip: { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 44 },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    maxWidth: 220,
  },
  pickerList: { maxHeight: 280 },
  pickerRows: { gap: 12 },
  progress: { gap: 8 },
  dialogActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  dialogButton: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  backdrop: { ...positioned, top: 0, left: 0, right: 0, bottom: 0 },
  // Bottom sheet narrow, centred card wide: the reader's geometry (SaveToSheet).
  sheet: {
    ...positioned,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 18,
    paddingHorizontal: 16,
    elevation: 12,
  },
  // Text dialogs (Generate, delete confirm) get breathing room the menu sheet
  // does not need: 20 px padding and a 12 px gap so the title, its description,
  // the pickers and the progress bar never touch (issue #48 review, S1/S7).
  dialogBody: { paddingTop: 20, paddingBottom: 20, paddingHorizontal: 20, gap: 12 },
  srOnly: { left: -9999, opacity: 0, position: "absolute" as const },
});

/**
 * The wide text dialog, centred over the Shell's capped content column rather
 * than the viewport's middle third (issue #48 review, S7): the column centres
 * itself in the viewport, so a capped dialog at the viewport's centre sits at
 * the column's centre at every width.
 */
export function centeredDialog(viewWidth: number): ViewStyle {
  const width = Math.min(520, viewWidth - 32);
  return {
    ...positioned,
    top: "15%",
    left: (viewWidth - width) / 2,
    width,
    maxHeight: "70%",
    borderRadius: 12,
    borderWidth: 1,
    elevation: 12,
  };
}
