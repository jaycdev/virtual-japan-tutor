import type { DictionaryEntry, ItemList, StoryGrammarSpan } from "@vjt/api-client";
import { sensePartOfSpeechLabels, useT } from "@vjt/core";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { T, TableText } from "@/components/Text.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { JlptBadge, SrsLevelText } from "./parts.tsx";
import { PitchGraph, pitchCaption } from "./PitchGraph.tsx";

/**
 * The reader's overlays (ui-plan 4.1): the Dictionary Entry, the grammar detail
 * and Save to Item List are centred Dialogs, and a bottom Sheet below a 640 px
 * viewport so a phone browser still gets thumb-reach actions. The media query
 * is the only thing that picks between them.
 */
export function ReaderDialog({
  open,
  onOpenChange,
  title,
  description,
  testId,
  onCloseAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  testId: string;
  /** Returns focus to the word that opened the overlay when it closes. */
  onCloseAutoFocus?: () => void;
  children: ReactNode;
}) {
  const narrow = useMediaQuery("(max-width: 639px)");
  const closeFocus = onCloseAutoFocus ? (e: Event) => {
    e.preventDefault();
    onCloseAutoFocus();
  } : undefined;

  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" data-testid={testId} className="max-h-[85dvh] overflow-y-auto p-4" onCloseAutoFocus={closeFocus}>
          <SheetHeader className="p-0 pr-8">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testId} onCloseAutoFocus={closeFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** A Dictionary Entry: headword, reading, JLPT level, pitch and every sense. */
export function DictionaryBody({ entry }: { entry: DictionaryEntry }) {
  const { t, language } = useT();
  const reading = entry.reading !== entry.headword ? entry.reading : null;
  // Each sense's Part of Speech (issue #132), with a repeat of the sense above left out.
  const partsOfSpeech = sensePartOfSpeechLabels(entry.senses, t);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {reading ? <p className="text-body text-muted-foreground">{reading}</p> : null}
        {entry.srsLevel != null ? <SrsLevelText level={entry.srsLevel} /> : null}
        {entry.jlptLevel ? <JlptBadge level={entry.jlptLevel} /> : null}
      </div>
      {entry.pitch ? (
        <div className="flex items-center gap-3 text-pitch">
          <PitchGraph pitch={entry.pitch} />
          <p className="text-caption text-muted-foreground">{pitchCaption(entry.pitch, language)}</p>
        </div>
      ) : null}
      {entry.senses.map((sense, i) => (
        <div key={i} className="flex flex-col gap-1">
          {partsOfSpeech[i] ? (
            <p className="text-caption text-muted-foreground">
              <TableText segments={partsOfSpeech[i]} />
            </p>
          ) : null}
          {sense.glosses.map((gloss, j) => (
            <p key={j} className="text-body text-foreground">
              {gloss}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A Grammar Point: its pattern and meaning, with the JLPT level. */
export function GrammarBody({ span }: { span: StoryGrammarSpan }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-foreground">{span.meaning}</p>
      {span.jlptLevel || span.srsLevel != null ? (
        <div className="flex items-center gap-3">
          {span.srsLevel != null ? <SrsLevelText level={span.srsLevel} /> : null}
          {span.jlptLevel ? <JlptBadge level={span.jlptLevel} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Item List picker. Saving into a list is one press; a new list is created
 * first and only then saved into (create-then-save), so a failed create never
 * leaves a half-made list behind.
 */
export function SaveBody({
  lists,
  defaultListId,
  busy,
  error,
  onSaveToList,
  onCreateAndSave,
}: {
  lists: ItemList[];
  defaultListId: string | null;
  busy: boolean;
  // A ReactNode: StoryReader keeps the whole sentence (a <T> element or the
  // server's own words), so the furigana is not lost in a {message} param
  // (issue #125).
  error: ReactNode;
  onSaveToList: (listId: string) => void;
  onCreateAndSave: (name: string) => void;
}) {
  const { tp } = useT();
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="flex max-h-64 flex-col overflow-y-auto">
        {lists.map((list) => (
          <li key={list.id}>
            <button
              type="button"
              data-testid={`save-list-${list.id}`}
              disabled={busy}
              onClick={() => onSaveToList(list.id)}
              className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-2 text-left text-body text-foreground hover:bg-accent disabled:opacity-50"
            >
              <span>{list.name}</span>
              {list.id === defaultListId ? (
                <span className="text-caption text-muted-foreground">
                  <T k="itemList.defaultWord" />
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          setName("");
          onCreateAndSave(trimmed);
        }}
      >
        <Input
          aria-label={tp("reader.newListName")}
          placeholder={tp("reader.newListName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" aria-label={tp("reader.createAndSaveAria")} disabled={busy || !trimmed}>
          <T k="reader.create" />
        </Button>
      </form>
    </div>
  );
}
