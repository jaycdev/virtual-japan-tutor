import type { Story, StoryGenerationProgress, StorySuggestions } from "@vjt/api-client";
import type { StoryGenerationState, StoryLibraryState } from "@vjt/core";
import {
  genreLabel,
  genreRuby,
  originLabel,
  progressStageKey,
  progressStageParams,
  stageLabel,
  storyCardMetaRuby,
  storyDate,
  useT,
  type RubyText,
  type StringKey,
} from "@vjt/core";
import * as DialogPrimitives from "@rn-primitives/dialog";
import * as DropdownMenuPrimitive from "@rn-primitives/dropdown-menu";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Icon, type IconName } from "./components/ui/icon.tsx";
import { useSheetBottomInset } from "./components/ui/sheet.ts";
import { EmptyState, InlineError, ProgressBar, SkeletonBar } from "./state/states.tsx";
import { Labeled, T, TableText, labelAria } from "./components/Text.tsx";

/**
 * The pieces of the rebuilt Stories page (issue #48, plan §4.5).
 *
 * The card, the per-card menu, the delete confirmation and the Generate dialog
 * are bottom sheets pinned to the bottom edge, the same form the reader's
 * overlays take on the phone (issue #45 review). Styling is design-token classes
 * only (plan §3): the styles below are geometry (touch sizes, radii, sheet
 * edges), never colour or font size.
 */

// The Story words moved to @vjt/core (issue #79); re-exported here so the
// screens that import them from this file keep working.
export { genreLabel, originLabel, stageLabel, storyDate };

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
  label: ReactNode;
  onPress: () => void;
  filled?: boolean;
  disabled?: boolean;
  /** Stretches to the full width of the column (the pinned Generate button). */
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
      // A plain string names the button; a <T> (issue #125) carries its own
      // plain-Japanese label, so an explicit accessibilityLabel still wins.
      accessibilityLabel={accessibilityLabel ?? (typeof label === "string" ? label : undefined)}
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
      {typeof label === "string" ? (
        <Text className={`text-body font-semibold ${text}`}>{label}</Text>
      ) : (
        // The button's name is the explicit accessibilityLabel; the drawn
        // line hides so the sentence is not announced twice.
        accessibilityLabel !== undefined ? <Labeled>{label}</Labeled> : label
      )}
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
  const { language, tp } = useT();
  return (
    <Card testID={`story-card-${story.id}`}>
      <View className="flex-row items-center gap-1">
        <Pressable
          testID={`story-open-${story.id}`}
          accessibilityRole="button"
          accessibilityLabel={tp("stories.ariaOpen", { title: story.title })}
          accessibilityHint={tp("mobile.storyOpensReader")}
          onPress={onOpen}
          style={styles.titlePress}
        >
          {/* The Story Title is Learner content: never translated, never
              annotated — the coverage check exempts it by this testID. */}
          <Text testID="story-card-title" className="text-body font-semibold text-foreground" numberOfLines={2}>
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
            accessibilityLabel={tp("mobile.storyReadOn", { date: storyDate(story.readAt, language) })}
          >
            {/* The check is the mark; the words spell it out for screen readers
                and for anyone scanning the grid. The View already names itself;
                the drawn badge stays out of the tree. */}
            <Icon name="check" size="xs" className="text-primary" />
            <Labeled>
              <T k="stories.readBadge" className="text-caption text-muted-foreground" />
            </Labeled>
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
          accessibilityLabel={revealed ? undefined : tp("stories.ariaShowTranslation")}
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
            // Hidden: the button names itself with the action; the drawn hint
            // stays out of the tree.
            <Labeled>
              <T k="mobile.readerTitleHiddenNote" className="text-caption text-muted-foreground" />
            </Labeled>
          )}
        </Pressable>
      ) : null}

      {/* The meta line follows the Interface Language; the segments carry their
          own styling, so the test slot is a View around the drawn line. */}
      <View testID={`story-meta-${story.id}`}>
        <TableText segments={storyCardMetaRuby(story, language)} className="text-caption text-muted-foreground" />
      </View>
    </Card>
  );
}

/**
 * The card's menu: Mark Read / Mark unread, and Delete. The rows sit in a Dialog
 * sheet at the bottom edge, where they are thumb-reachable and touch-sized (the
 * TokenMenu split, issue #45 review). The trigger is icon-only, so it carries a label.
 */
export function StoryMenu({
  story,
  onMarkRead,
  onMarkUnread,
  onAskDelete,
}: {
  story: Story;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onAskDelete: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const inset = useSheetBottomInset();
  const { tp } = useT();
  const label = tp("stories.ariaActions", { title: story.title });

  const trigger = (onPress?: () => void, expanded?: boolean) => (
    <Pressable
      testID={`story-menu-${story.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={tp("mobile.storyMenuHint")}
      accessibilityState={{ expanded: expanded ?? false }}
      onPress={onPress}
      hitSlop={8}
      style={styles.trigger}
      className="rounded-md active:bg-accent"
    >
      <Icon name="menu" size="sm" className="text-muted-foreground" />
    </Pressable>
  );

  const rows = (onPick: (action: () => void) => void) => (
    <>
      <MenuRow
        variant="sheet"
        testID="menu-mark-read"
        label={
          <T
            k={story.readAt ? "stories.markUnread" : "stories.markRead"}
            className="text-body text-foreground"
          />
        }
        accessibilityLabel={tp(story.readAt ? "stories.markUnread" : "stories.markRead")}
        icon={story.readAt ? "close" : "check"}
        onPress={() => onPick(story.readAt ? onMarkUnread : onMarkRead)}
      />
      <MenuRow
        variant="sheet"
        testID="menu-delete"
        label={<T k="stories.delete" className="text-body text-destructive" />}
        accessibilityLabel={tp("stories.delete")}
        icon="trash"
        destructive
        onPress={() => onPick(onAskDelete)}
      />
    </>
  );

  return (
    <>
      {trigger(() => setSheetOpen(true), sheetOpen)}
      {sheetOpen ? (
        <DialogPrimitives.Root open onOpenChange={(open) => !open && setSheetOpen(false)}>
          <DialogPrimitives.Portal>
            <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
            <DialogPrimitives.Content
              testID="story-menu-sheet"
              style={StyleSheet.flatten([styles.sheet, { paddingBottom: 18 + inset }])}
              className="bg-card border-t border-border"
            >
              {/* A labelled surface still needs a title for assistive tech. */}
              <DialogPrimitives.Title style={styles.srOnly}>{label}</DialogPrimitives.Title>
              {rows((action) => {
                setSheetOpen(false);
                action();
              })}
            </DialogPrimitives.Content>
          </DialogPrimitives.Portal>
        </DialogPrimitives.Root>
      ) : null}
    </>
  );
}

/**
 * One menu row. The Picker's options sit in a DropdownMenu, so there the row
 * must itself be an Item for the primitives to see it as a menu item; in a
 * Dialog sheet it is a plain Pressable row.
 */
function MenuRow({
  variant,
  testID,
  label,
  accessibilityLabel,
  icon,
  selected = false,
  destructive = false,
  onPress,
}: {
  variant: "menu" | "sheet";
  testID: string;
  /** A string is learning content or already translated; a <T> follows the Interface Language and brings its own text classes. */
  label: ReactNode;
  /** The row's name for assistive tech; needed when the visible label is a <T> drawing furigana. */
  accessibilityLabel?: string;
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
      {typeof label === "string" ? (
        <Text className={`text-body ${selected ? "font-semibold text-primary" : tone}`}>{label}</Text>
      ) : (
        // The row's name is the explicit accessibilityLabel; a drawn <T> hides
        // so the sentence is not announced twice (S4).
        accessibilityLabel !== undefined ? <Labeled>{label}</Labeled> : label
      )}
      {selected ? <Icon name="check" size="sm" className="text-primary" /> : null}
    </>
  );
  if (variant === "menu") {
    return (
      <DropdownMenuPrimitive.Item
        testID={testID}
        // RN Primitives' Item names the row through role rather than RN's accessibility props.
        role="menuitem"
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
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
      accessibilityLabel={accessibilityLabel}
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
 * destructive action. A bottom sheet, the SaveToSheet geometry.
 */
export function ConfirmDelete({
  story,
  pending,
  error,
  onKeep,
  onConfirm,
}: {
  story: Story;
  pending: boolean;
  error: string | null;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const inset = useSheetBottomInset();
  const { t, tp } = useT();
  return (
    <DialogPrimitives.Root open onOpenChange={(open) => !open && onKeep()}>
      <DialogPrimitives.Portal>
        <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitives.Content
          testID="confirm-delete"
          style={{ ...styles.sheet, ...styles.dialogBody, paddingBottom: 20 + inset }}
          className="bg-card border-t border-border"
        >
          {/* The primitives want their title/description as their own Text; a
              furigana line is a row of columns, not a string. So the a11y names
              sit hidden (the StoryMenu's pattern) and the visible lines draw
              below with their readings. */}
          <DialogPrimitives.Title style={styles.srOnly}>
            {tp("stories.deleteTitle")}
          </DialogPrimitives.Title>
          <TableText
            segments={t("stories.deleteTitle")}
            className="text-title-sm font-semibold text-foreground"
            accessibilityRole="header"
          />
          <DialogPrimitives.Description style={styles.srOnly}>
            {tp("mobile.storyDeleteBody", { title: story.title })}
          </DialogPrimitives.Description>
          {/* The non-breaking tie in the table entry keeps “Practice Records
              stay.” from orphaning a single word on a narrow phone. */}
          <TableText
            segments={t("mobile.storyDeleteBody", { title: story.title })}
            className="text-small text-muted-foreground"
          />
          {error ? (
            <Text accessibilityRole="alert" role="alert" testID="confirm-delete-error" className="text-small text-destructive">
              {error}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Pressable
              testID="confirm-delete-keep"
              accessibilityRole="button"
              accessibilityLabel={tp("stories.deleteKeep")}
              onPress={onKeep}
              style={styles.dialogButton}
              className="border border-border bg-card active:opacity-80"
            >
              <T k="stories.deleteKeep" className="text-body font-semibold text-foreground" />
            </Pressable>
            <Pressable
              testID="confirm-delete-accept"
              accessibilityRole="button"
              accessibilityLabel={tp("common.confirmDelete")}
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={onConfirm}
              style={styles.dialogButton}
              className={`bg-destructive active:opacity-80${pending ? " opacity-50" : ""}`}
            >
              <T k="stories.delete" className="text-body font-semibold text-destructive-foreground" />
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
  const inset = useSheetBottomInset();
  const { t, tp } = useT();
  // One error line, inside the dialog, and only for a run this dialog started:
  // an old server `failed` must not greet a dialog that has started nothing (S2).
  // The table fallback stays a <T> so it carries furigana; the server's own
  // message is a plain string.
  const failure =
    runHere && generation.status === "failed"
      ? (generation.progress.message ?? <T k="story.runFailed" className="text-small text-destructive" />)
      : null;
  const alert: string | ReactNode | null = failure ?? (runHere ? error : null);
  return (
    <DialogPrimitives.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitives.Portal>
        <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitives.Content
          testID="generate-dialog"
          style={{ ...styles.sheet, ...styles.dialogBody, paddingBottom: 20 + inset }}
          className="bg-card border-t border-border"
        >
          <DialogPrimitives.Title style={styles.srOnly}>
            {tp("today.storyGenerate")}
          </DialogPrimitives.Title>
          <TableText
            segments={t("today.storyGenerate")}
            className="text-title-sm font-semibold text-foreground"
            accessibilityRole="header"
          />
          <DialogPrimitives.Description style={styles.srOnly}>
            {tp("stories.generateBody")}
          </DialogPrimitives.Description>
          <TableText segments={t("stories.generateBody")} className="text-small text-muted-foreground" />

          <View style={styles.pickerRows}>
            <View className="flex-row items-center justify-between gap-3">
              <T k="stories.genre" className="text-small text-muted-foreground" />
              <Picker
                testID="generate-genre-picker"
                ariaLabel={tp("mobile.genreForStory")}
                placeholder={tp("stories.anyGenre")}
                placeholderKey="stories.anyGenre"
                value={genre}
                options={suggestions.genres}
                onChange={onGenreChange}
              />
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <T k="stories.theme" className="text-small text-muted-foreground" />
              <Picker
                testID="generate-theme-picker"
                ariaLabel={tp("mobile.themeForStory")}
                placeholder={tp("stories.anyTheme")}
                placeholderKey="stories.anyTheme"
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
                label={
                  <TableText
                    segments={[
                      ...t(progressStageKey(generation.progress), progressStageParams(generation.progress)),
                      { text: ` ${Math.round(generation.progress.percent ?? 0)}%` },
                    ]}
                    className="text-caption text-muted-foreground"
                  />
                }
              />
            </View>
          ) : null}
          {alert ? (
            typeof alert === "string" ? (
              <Text accessibilityRole="alert" role="alert" testID="generate-error" className="text-small text-destructive">
                {alert}
              </Text>
            ) : (
              <View accessibilityRole="alert" role="alert" testID="generate-error">
                {alert}
              </View>
            )
          ) : null}

          <View style={styles.dialogActions}>
            <Pressable
              testID="generate-cancel"
              accessibilityRole="button"
              accessibilityLabel={tp("common.cancel")}
              onPress={onClose}
              style={styles.dialogButton}
              className="border border-border bg-card active:opacity-80"
            >
              <Labeled>
                <T k="common.cancel" className="text-body font-semibold text-foreground" />
              </Labeled>
            </Pressable>
            <Pressable
              testID="generate-confirm"
              accessibilityRole="button"
              accessibilityLabel={tp("stories.generateConfirm")}
              accessibilityHint={running ? tp("mobile.storyRunningHint") : tp("mobile.storyGenerateHint")}
              accessibilityState={{ disabled: running }}
              disabled={running}
              onPress={onGenerate}
              style={styles.dialogButton}
              className={`bg-primary active:opacity-80${running ? " opacity-50" : ""}`}
            >
              <Labeled>
                <T k="stories.generateConfirm" className="text-body font-semibold text-primary-foreground" />
              </Labeled>
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
 * the primitives handle touch and keyboard, and the picker is an anchored popup.
 * The first row is the "Any" choice, which means the field is left out of the
 * request.
 */
export function Picker({
  testID,
  ariaLabel,
  placeholder,
  placeholderKey,
  value,
  options,
  onChange,
}: {
  testID: string;
  ariaLabel: string;
  /** The "Any" choice in plain words — the name for assistive tech, and the
   *  drawing when the caller passes no table key. */
  placeholder: string;
  /** Draw the placeholder from the string table, furigana included (issue #125). */
  placeholderKey?: StringKey;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  // The primitive owns the menu, but reports every open and close here;
  // mirroring that state lets the trigger tell assistive tech what the
  // chevron already tells the eye (issue #48 review, N1).
  const [open, setOpen] = useState(false);
  const { language, t } = useT();
  // The chosen word in the Learner's language, annotated: a Genre the table
  // has never seen (a typed genre, any Theme) passes through plain, exactly as
  // genreLabel always showed it.
  const shown = value !== null ? genreRuby(value, language) : [];
  const shownSegments: RubyText =
    value === null
      ? placeholderKey
        ? t(placeholderKey)
        : [{ text: placeholder }]
      : shown.length > 0
        ? shown
        : [{ text: value }];
  return (
    <DropdownMenuPrimitive.Root onOpenChange={setOpen}>
      <DropdownMenuPrimitive.Trigger asChild>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${ariaLabel}: ${value ? genreLabel(value, language) || value : placeholder}`}
          accessibilityState={{ expanded: open }}
          style={styles.picker}
          className="rounded-md border border-border bg-card active:bg-accent"
        >
          <TableText segments={shownSegments} className="text-small text-foreground" />
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
              <MenuRow
                variant="menu"
                testID={`${testID}-any`}
                label={
                  placeholderKey ? (
                    <TableText
                      segments={t(placeholderKey)}
                      className={`text-body ${value === null ? "font-semibold text-primary" : "text-foreground"}`}
                    />
                  ) : (
                    placeholder
                  )
                }
                accessibilityLabel={placeholder}
                selected={value === null}
                onPress={() => onChange(null)}
              />
              {options.map((option) => (
                <MenuRow
                  key={option}
                  variant="menu"
                  testID={`${testID}-option-${option}`}
                  label={
                    <TableText
                      segments={genreRuby(option, language)}
                      className={`text-body ${option === value ? "font-semibold text-primary" : "text-foreground"}`}
                    />
                  }
                  accessibilityLabel={genreLabel(option, language) || option}
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
  /** A plain string draws itself; a <T> follows the Interface Language (issue #125)
   *  and brings its own text classes, like the other labelled controls. */
  label: ReactNode;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { tp } = useT();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={labelAria(label, tp)}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.chip}
      // Selection reads as fill + weight, never a heavier border: a 2 px border
      // would change the chip's size the moment it is pressed (issue #48, N2).
      className={`rounded-md px-4 border border-border active:bg-accent ${active ? "bg-accent" : "bg-card"}`}
    >
      {typeof label === "string" ? (
        <Text className={`text-small ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</Text>
      ) : (
        // The chip already speaks this sentence as its name; the drawn line
        // stays out of the accessibility tree.
        <Labeled>{label}</Labeled>
      )}
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
    return (
      <InlineError
        message={<T k="mobile.storiesLoadFailed" params={{ message: library.message }} className="text-body text-destructive" />}
        onRetry={onRetry}
      />
    );
  }
  if (library.status === "ready" && visibleCount === 0) {
    if (library.page.items.length > 0) {
      return (
        <Card testID="library-empty">
          <EmptyState
            compact
            message={<T k="stories.noneMatch" className="text-center text-body text-muted-foreground" />}
            actionLabel={<T k="stories.clearFilters" className="text-body font-semibold text-primary" />}
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
            filtered ? (
              <T k="stories.noneFiltered" className="text-center text-body text-muted-foreground" />
            ) : (
              <T k="stories.noneAny" className="text-center text-body text-muted-foreground" />
            )
          }
          actionLabel={<T k="today.storyGenerate" className="text-body font-semibold text-primary" />}
          onAction={onGenerate}
        />
      </Card>
    );
  }
  return null;
}

/** The pinned Today card's progress block, shared by the page and the dialog. */
export function GenerationProgress({ progress }: { progress: StoryGenerationProgress }) {
  const { t } = useT();
  return (
    <View testID="generation-progress" style={styles.progress}>
      <ProgressBar
        value={(progress.percent ?? 0) / 100}
        label={
          <TableText
            segments={[
              ...t(progressStageKey(progress), progressStageParams(progress)),
              { text: ` ${Math.round(progress.percent ?? 0)}%` },
            ]}
            className="text-caption text-muted-foreground"
          />
        }
      />
      <T k="mobile.storiesKeepWriting" className="text-caption text-muted-foreground" />
    </View>
  );
}

// Overlays portal into the Shell's PortalHost, so `absolute` fills the screen
// (issue #45 review).
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
    // A shadow reads as a floating card (elevation on Android).
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
  // The bottom sheet: the reader's geometry (SaveToSheet).
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


