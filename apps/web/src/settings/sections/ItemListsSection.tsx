// Item Lists (issue #12's management; ported from apps/mobile ItemListsSettings):
// create, rename, delete and mark lists; choose the Default List and a Boosting
// List; manage membership. Practice links here as /settings/lists.
import type { ItemList, ItemListMember } from "@vjt/api-client";
import {
  ITEM_KINDS,
  isSavedList,
  itemListHint,
  itemKindLabel,
  useItemLists,
  useT,
  type ActionResult,
  type ItemKind,
  type ItemListsView,
} from "@vjt/core";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { T } from "@/components/Text";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { ChoiceGroup, Note, SectionBody, SwitchField, TextField, Subheading } from "../parts.tsx";

export function ItemListsSection() {
  const { client } = useSession();
  const lists = useItemLists(client);
  const [openId, setOpenId] = useState<string | null>(null);
  // Once a detail has been opened, the master only reappears through "Back to
  // all lists", which unmounts itself and would drop focus: the master's
  // heading takes it instead. A first load (no detail opened) takes nothing.
  const [detailOpened, setDetailOpened] = useState(false);

  if (lists.state.status === "loading") return <SkeletonLines lines={3} />;
  if (lists.state.status === "error") {
    return (
      <ErrorState
        message={<T k="settings.listsLoadFailed" params={{ message: lists.state.message }} />}
        onRetry={lists.reload}
      />
    );
  }

  const open = lists.state.lists.find((list) => list.id === openId) ?? null;
  if (open) {
    return (
      <ListDetail
        lists={lists}
        list={open}
        isDefault={lists.state.defaultListId === open.id}
        onBack={() => setOpenId(null)}
      />
    );
  }
  return (
    <ListsMaster
      lists={lists}
      backFocus={detailOpened}
      onOpen={(id) => {
        setDetailOpened(true);
        setOpenId(id);
      }}
    />
  );
}

/** Runs a write, returns whether it worked and shows the message when it did not. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const run = async (action: () => Promise<ActionResult>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await action();
      if (!res.ok) setError(res.message);
      return res.ok;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function ListsMaster({
  lists,
  onOpen,
  backFocus,
}: {
  lists: ItemListsView;
  onOpen: (id: string) => void;
  backFocus: boolean;
}) {
  const { language, tp } = useT();
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const state = lists.state.status === "ready" ? lists.state : null;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // This mount replaced a detail ("Back to all lists" unmounted itself): the
  // heading takes the lost focus. A first load does not steal focus.
  useEffect(() => {
    if (backFocus) headingRef.current?.focus();
  }, [backFocus]);

  const addList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await run(() => lists.createList({ name: trimmed, boosting: false }))) setName("");
  };

  return (
    <SectionBody>
      {error ? <p role="alert" className="text-small text-destructive">{error}</p> : null}
      <Note>
        <T k="lists.introNote" />
      </Note>

      <Subheading ref={headingRef}>
        <T k="lists.yourLists" />
      </Subheading>
      {state && state.lists.length === 0 ? (
        <p className="text-body text-muted-foreground">
          <T k="lists.empty" />
        </p>
      ) : null}
      {state && state.lists.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {state.lists.map((list) => (
            <li key={list.id}>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-between rounded-none px-4 py-3 text-left"
                onClick={() => onOpen(list.id)}
              >
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="text-body font-medium text-foreground">{list.name}</span>
                  <span className="text-small text-muted-foreground">{itemListHint(list, language)}</span>
                </span>
                <span className="text-small text-primary">
                  <T k="lists.manage" />
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="flex flex-col gap-4" onSubmit={(event) => void addList(event)} noValidate>
        <Subheading>
          <T k="lists.addHeading" />
        </Subheading>
        <TextField
          id="list-name"
          label={<T k="lists.nameLabel" />}
          value={name}
          maxLength={60}
          placeholder={tp("lists.namePlaceholder")}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <div>
          <Button type="submit" disabled={busy || name.trim() === ""}>
            <T k="lists.addSubmit" />
          </Button>
        </div>
      </form>
    </SectionBody>
  );
}

function ListDetail({
  lists,
  list,
  isDefault,
  onBack,
}: {
  lists: ItemListsView;
  list: ItemList;
  isDefault: boolean;
  onBack: () => void;
}) {
  const { language, tp } = useT();
  const { busy, error, setError, run } = useAction();
  const [members, setMembers] = useState<{ rows: ItemListMember[] | null; error?: string }>({ rows: null });
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(list.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [kind, setKind] = useState<ItemKind>("vocabulary");
  const [itemRef, setItemRef] = useState("");
  const [added, setAdded] = useState(false);
  const { listItems } = lists;

  // Focus stays with the Learner when controls unmount: the "Manage" button that
  // opened this detail is gone (mount), and Rename/Save swap the name heading for
  // a field and back (renaming), and a member's "Remove" button removes its own
  // row. Each hands focus to the nearest stable heading instead of to <body>.
  const nameRef = useRef<HTMLHeadingElement>(null);
  const itemsRef = useRef<HTMLHeadingElement>(null);
  const wasRenaming = useRef(false);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  useEffect(() => {
    if (wasRenaming.current && !renaming) nameRef.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);

  const reread = async () => {
    const res = await listItems(list.id);
    setMembers(res.ok ? { rows: res.members ?? [] } : { rows: null, error: res.message });
  };

  // Membership is read on open, and again whenever the count changes elsewhere.
  useEffect(() => {
    let cancelled = false;
    void listItems(list.id).then((res) => {
      if (cancelled) return;
      setMembers(res.ok ? { rows: res.members ?? [] } : { rows: null, error: res.message });
    });
    return () => {
      cancelled = true;
    };
  }, [list.id, list.itemCount, listItems]);

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    if (await run(() => lists.updateList(list.id, { name: trimmed }))) setRenaming(false);
  };

  const remove = async () => {
    setConfirmingDelete(false);
    if (await run(() => lists.deleteList(list.id))) onBack();
  };

  const removeMember = async (member: ItemListMember) => {
    if (await run(() => lists.removeFromList(list.id, { itemKind: member.itemKind, itemRef: member.itemRef }))) {
      // The row's Remove button is about to unmount with the row: take focus to
      // the Items heading before it goes.
      itemsRef.current?.focus();
      void reread();
    }
  };

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ref = itemRef.trim();
    if (!ref) return;
    if (await run(() => lists.addToList(list.id, { itemKind: kind, itemRef: ref }))) {
      setItemRef("");
      setAdded(true);
      void reread();
    }
  };

  const saved = isSavedList(list);

  return (
    <SectionBody>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          <T k="lists.back" />
        </Button>
      </div>
      {error ? <p role="alert" className="text-small text-destructive">{error}</p> : null}

      {renaming ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void rename(event)} noValidate>
          <TextField
            id="list-rename"
            label={<T k="lists.renameLabel" />}
            value={renameValue}
            maxLength={60}
            disabled={busy}
            onChange={(event) => setRenameValue(event.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy || renameValue.trim() === ""}>
              <T k="lists.saveName" />
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
              <T k="common.cancel" />
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Subheading ref={nameRef}>{list.name}</Subheading>
          <SwitchField
            id="list-boosting"
            label={<T k="lists.boostingLabel" />}
            hint={<T k="lists.boostingHint" />}
            checked={list.boosting}
            disabled={busy}
            onChange={(boosting) => void run(() => lists.updateList(list.id, { boosting }))}
          />
          <div className="flex flex-wrap gap-2">
            {isDefault ? (
              <Note>
                <T k="lists.defaultNote" />
              </Note>
            ) : (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => lists.setDefaultList(list.id))}>
                <T k="lists.makeDefault" />
              </Button>
            )}
            {saved ? null : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(true);
                    setRenameValue(list.name);
                    setError(undefined);
                  }}
                >
                  <T k="common.rename" />
                </Button>
                {confirmingDelete ? (
                  <>
                    <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
                      <T k="common.confirmDelete" />
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                      <T k="stories.deleteKeep" />
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                    <T k="lists.deleteList" />
                  </Button>
                )}
              </>
            )}
          </div>
          {saved ? (
            <Note>
              <T k="lists.savedNote" />
            </Note>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Subheading ref={itemsRef}>
          <T k="lists.itemsHeading" params={{ count: list.itemCount }} />
        </Subheading>
        {members.error ? (
          <ErrorState message={members.error} onRetry={() => void reread()} />
        ) : members.rows === null ? (
          <SkeletonLines lines={3} />
        ) : members.rows.length === 0 ? (
          <p className="text-body text-muted-foreground">
            <T k="lists.itemsEmpty" />
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {members.rows.map((item) => (
              <li key={`${item.itemKind}:${item.itemRef}`} className="flex items-center justify-between gap-4 px-4 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="text-body text-foreground">{item.surface}</span>
                  {item.gloss ? <span className="text-small text-muted-foreground">{item.gloss}</span> : null}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  className="text-destructive"
                  aria-label={tp("lists.removeAria", { surface: item.surface })}
                  disabled={busy}
                  onClick={() => void removeMember(item)}
                >
                  <T k="common.remove" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="flex flex-col gap-4" onSubmit={(event) => void addMember(event)} noValidate>
        <Subheading>
          <T k="lists.addItemHeading" />
        </Subheading>
        <ChoiceGroup
          legend={<T k="lists.kindLegend" />}
          options={ITEM_KINDS.map((k) => ({ value: k, label: itemKindLabel(k, language) }))}
          value={kind}
          onChange={setKind}
          disabled={busy}
        />
        <TextField
          id="list-item-ref"
          label={<T k="lists.refLabel" />}
          hint={kind === "kanji" ? <T k="lists.kanjiRefHint" /> : undefined}
          value={itemRef}
          inputMode={kind === "kanji" ? "text" : "numeric"}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => {
            setItemRef(event.target.value);
            setAdded(false);
          }}
        />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={busy || itemRef.trim() === ""}>
            <T k="lists.addToSubmit" />
          </Button>
          {added ? (
            <p role="status" className="text-small text-success">
              <T k="lists.added" />
            </p>
          ) : null}
        </div>
      </form>
    </SectionBody>
  );
}
