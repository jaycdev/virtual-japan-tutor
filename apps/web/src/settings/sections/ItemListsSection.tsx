// Item Lists (issue #12's management; ported from apps/mobile ItemListsSettings):
// create, rename, delete and mark lists; choose the Default List and a Boosting
// List; manage membership. Practice links here as /settings/lists.
import type { ItemList, ItemListMember } from "@vjt/api-client";
import {
  ITEM_KINDS,
  ITEM_KIND_LABELS,
  isSavedList,
  itemListHint,
  useItemLists,
  type ActionResult,
  type ItemKind,
  type ItemListsView,
} from "@vjt/core";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { ChoiceGroup, Note, SectionBody, SwitchField, TextField, Subheading } from "../parts.tsx";

export function ItemListsSection() {
  const { client } = useSession();
  const lists = useItemLists(client);
  const [openId, setOpenId] = useState<string | null>(null);

  if (lists.state.status === "loading") return <SkeletonLines lines={3} />;
  if (lists.state.status === "error") {
    return <ErrorState message={`Cannot load your Item Lists: ${lists.state.message}`} onRetry={lists.reload} />;
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
  return <ListsMaster lists={lists} onOpen={setOpenId} />;
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

function ListsMaster({ lists, onOpen }: { lists: ItemListsView; onOpen: (id: string) => void }) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const state = lists.state.status === "ready" ? lists.state : null;

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
        Saving a word from a story adds it to the Default List. A Boosting List also pulls its not-yet-known items into
        your stories’ Focus Sets. Choose a list to manage its items.
      </Note>

      {state && state.lists.length === 0 ? <p className="text-body text-muted-foreground">No lists yet.</p> : null}
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
                  <span className="text-small text-muted-foreground">{itemListHint(list)}</span>
                </span>
                <span className="text-small text-primary">Manage</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="flex flex-col gap-4" onSubmit={(event) => void addList(event)} noValidate>
        <Subheading>Add a list</Subheading>
        <TextField
          id="list-name"
          label="List name"
          value={name}
          maxLength={60}
          placeholder="food, travel…"
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <div>
          <Button type="submit" disabled={busy || name.trim() === ""}>
            Add list
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
  const { busy, error, setError, run } = useAction();
  const [members, setMembers] = useState<{ rows: ItemListMember[] | null; error?: string }>({ rows: null });
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(list.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [kind, setKind] = useState<ItemKind>("vocabulary");
  const [itemRef, setItemRef] = useState("");
  const [added, setAdded] = useState(false);
  const { listItems } = lists;

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
          Back to all lists
        </Button>
      </div>
      {error ? <p role="alert" className="text-small text-destructive">{error}</p> : null}

      {renaming ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void rename(event)} noValidate>
          <TextField
            id="list-rename"
            label="New name"
            value={renameValue}
            maxLength={60}
            disabled={busy}
            onChange={(event) => setRenameValue(event.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy || renameValue.trim() === ""}>
              Save name
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Subheading>{list.name}</Subheading>
          <SwitchField
            id="list-boosting"
            label="Boosting"
            hint="Push not-yet-known items into Focus Sets."
            checked={list.boosting}
            disabled={busy}
            onChange={(boosting) => void run(() => lists.updateList(list.id, { boosting }))}
          />
          <div className="flex flex-wrap gap-2">
            {isDefault ? (
              <Note>This is the Default List: a Save from a story goes here.</Note>
            ) : (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => lists.setDefaultList(list.id))}>
                Make default
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
                  Rename
                </Button>
                {confirmingDelete ? (
                  <>
                    <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
                      Confirm delete
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                    Delete list
                  </Button>
                )}
              </>
            )}
          </div>
          {saved ? <Note>Saved is built in: it can be configured, not renamed or deleted.</Note> : null}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Subheading>Items ({list.itemCount})</Subheading>
        {members.error ? (
          <ErrorState message={members.error} onRetry={() => void reread()} />
        ) : members.rows === null ? (
          <SkeletonLines lines={3} />
        ) : members.rows.length === 0 ? (
          <p className="text-body text-muted-foreground">No items yet.</p>
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
                  aria-label={`Remove ${item.surface}`}
                  disabled={busy}
                  onClick={() => void removeMember(item)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="flex flex-col gap-4" onSubmit={(event) => void addMember(event)} noValidate>
        <Subheading>Add an item</Subheading>
        <ChoiceGroup
          legend="Kind"
          options={ITEM_KINDS.map((k) => ({ value: k, label: ITEM_KIND_LABELS[k] }))}
          value={kind}
          onChange={setKind}
          disabled={busy}
        />
        <TextField
          id="list-item-ref"
          label="Reference (dictionary entry sequence or grammar point id)"
          hint={kind === "kanji" ? "For a Kanji, type the character itself." : undefined}
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
            Add to list
          </Button>
          {added ? (
            <p role="status" className="text-small text-success">
              Added.
            </p>
          ) : null}
        </div>
      </form>
    </SectionBody>
  );
}
