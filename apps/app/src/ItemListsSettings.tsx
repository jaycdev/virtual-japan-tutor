import type { ApiClient, ItemList, ItemListMember, components } from "@vjt/api-client";
import { useItemLists, type ActionResult } from "@vjt/core";
import { useCallback, useEffect, useState } from "react";

import { useHardwareBack } from "./hardwareBack.ts";
import { Body, Card, Chip, ChipRow, ErrorText, Field, LinkButton, Muted, PrimaryButton, Row, Screen, Scroll, SectionTitle, StatusText, Title, ToggleRow } from "./ui.tsx";

type ItemKind = components["schemas"]["ItemKind"];

const KIND_LABELS: Record<ItemKind, string> = {
  kanji: "Kanji",
  vocabulary: "Word",
  grammar: "Grammar",
};
const KINDS = Object.keys(KIND_LABELS) as ItemKind[];

/** The built-in Saved list: it cannot be renamed or deleted, only configured. */
const isSavedList = (l: ItemList): boolean => l.name.toLowerCase() === "saved";

/** Members as read for one list; null rows mean still loading, error means the read failed. */
interface MembersState {
  listId: string;
  rows: ItemListMember[] | null;
  error?: string;
}

/**
 * Item Lists on mobile (issue #12's management, brought up for issue #13):
 * create and delete lists, rename them, mark one Boosting, choose the Default
 * List, and manage membership — a master list of Cards; tapping one opens its
 * members, each removable, with an "add item" form. Mirrors the web section's
 * rules (Saved is built-in; membership is re-read after every write).
 */
export function ItemListsSettings({ client, onBack }: { client: ApiClient; onBack: () => void }) {
  const lists = useItemLists(client);
  const [openId, setOpenId] = useState<string | null>(null);
  const closeDetail = useCallback(() => setOpenId(null), []);
  // Hardware Back pops the open list back to the master view; on the master
  // (and on the section's own Back header button) nothing overrides Android.
  useHardwareBack(openId !== null, closeDetail);

  const open =
    lists.state.status === "ready"
      ? lists.state.lists.find((l) => l.id === openId) ?? null
      : null;

  // A deleted (or vanished) openId simply falls back to the master view:
  // `open` resolves to null, and tapping another list overwrites the id.
  // One useItemLists instance for the whole section: writes from the detail
  // screen re-read the shared lists, so the master rows stay honest too.
  if (open) {
    return (
      <ItemListDetail
        lists={lists}
        list={open}
        isDefault={lists.state.status === "ready" && lists.state.defaultListId === open.id}
        onBackToLists={closeDetail}
        onSectionBack={onBack}
      />
    );
  }

  return <ListsMaster lists={lists} onOpen={setOpenId} onBack={onBack} />;
}

function ListsMaster({
  lists,
  onOpen,
  onBack,
}: {
  lists: ReturnType<typeof useItemLists>;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const { state } = lists;
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

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

  const addList = async () => {
    const name = newName.trim();
    if (!name) return;
    if (await run(() => lists.createList({ name, boosting: false }))) setNewName("");
  };

  return (
    <Screen>
      <Scroll>
        <Title text="Item Lists" onBack={onBack} />
        {state.status === "loading" && <Muted text="Loading…" />}
        {state.status === "error" && (
          <>
            <ErrorText text={`Cannot load your Item Lists: ${state.message}`} />
            <LinkButton label="Retry" onPress={lists.reload} />
          </>
        )}
        {state.status === "ready" && (
          <>
            {error ? <ErrorText text={error} /> : null}
            <Muted text="Saving a word from a story adds it to the Default List. A Boosting List also pulls its not-yet-known items into your stories' Focus Sets. Tap a list to manage its items." />
            {state.lists.length === 0 && <Body text="No lists yet." />}
            {state.lists.map((l) => (
              <Card key={l.id}>
                <Row
                  label={l.name}
                  hint={`${l.isDefault ? "default · " : ""}${l.itemCount} ${l.itemCount === 1 ? "item" : "items"}${l.boosting ? " · boosting" : ""}`}
                  onPress={() => onOpen(l.id)}
                  last
                />
              </Card>
            ))}
            <SectionTitle text="Add a list" />
            <Field
              label="List name"
              value={newName}
              onChangeText={setNewName}
              onSubmit={() => void addList()}
              maxLength={60}
              placeholder="food, travel…"
              disabled={busy}
            />
            <PrimaryButton
              label="Add list"
              onPress={() => void addList()}
              disabled={busy || newName.trim() === ""}
            />
          </>
        )}
      </Scroll>
    </Screen>
  );
}

function ItemListDetail({
  lists,
  list,
  isDefault,
  onBackToLists,
  onSectionBack,
}: {
  lists: ReturnType<typeof useItemLists>;
  list: ItemList;
  isDefault: boolean;
  onBackToLists: () => void;
  onSectionBack: () => void;
}) {
  const { listItems } = lists;
  const [members, setMembers] = useState<MembersState | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(list.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [kind, setKind] = useState<ItemKind>("vocabulary");
  const [itemRef, setItemRef] = useState("");
  const [added, setAdded] = useState(false);

  const reread = async () => {
    const res = await listItems(list.id);
    if (res.ok) setMembers({ listId: list.id, rows: res.members ?? [] });
    else setMembers({ listId: list.id, rows: null, error: res.message });
  };

  // Read membership on open, and again whenever the row's count changes —
  // a write elsewhere or an out-of-band change keeps the list honest.
  useEffect(() => {
    let cancelled = false;
    void listItems(list.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setMembers({ listId: list.id, rows: res.members ?? [] });
      else setMembers({ listId: list.id, rows: null, error: res.message });
    });
    return () => {
      cancelled = true;
    };
  }, [list.id, list.itemCount, listItems]);

  const run = async (action: () => Promise<ActionResult>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    setAdded(false);
    try {
      const res = await action();
      if (!res.ok) setError(res.message);
      return res.ok;
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    const name = renameValue.trim();
    if (!name) return;
    if (await run(() => lists.updateList(list.id, { name }))) setRenaming(false);
  };

  const remove = async () => {
    setConfirmingDelete(false);
    if (await run(() => lists.deleteList(list.id))) onBackToLists();
  };

  const removeMember = async (m: ItemListMember) => {
    const ok = await run(() =>
      lists.removeFromList(list.id, { itemKind: m.itemKind, itemRef: m.itemRef }),
    );
    if (ok) void reread();
  };

  const addMember = async () => {
    const ref = itemRef.trim();
    if (!ref) return;
    const ok = await run(() => lists.addToList(list.id, { itemKind: kind, itemRef: ref }));
    if (ok) {
      setItemRef("");
      setAdded(true);
      void reread();
    }
  };

  const shown = members?.listId === list.id ? members : null;
  const memberRows = shown?.rows ?? null;

  return (
    <Screen>
      <Scroll>
        <Title text={list.name} onBack={onBackToLists} />
        {error ? <ErrorText text={error} /> : null}

        {renaming ? (
          <>
            <Field
              label="New name"
              value={renameValue}
              onChangeText={setRenameValue}
              onSubmit={() => void rename()}
              maxLength={60}
              disabled={busy}
            />
            <PrimaryButton
              label="Save name"
              onPress={() => void rename()}
              disabled={busy || renameValue.trim() === ""}
            />
            <LinkButton label="Cancel" onPress={() => setRenaming(false)} />
          </>
        ) : (
          <Card>
            <ToggleRow
              label="Boosting"
              hint="Push not-yet-known items into Focus Sets"
              value={list.boosting}
              disabled={busy}
              onToggle={(boosting) => void run(() => lists.updateList(list.id, { boosting }))}
            />
            {isDefault ? (
              <Row label="Default list" hint="A Save from a story goes here" />
            ) : (
              <Row
                label="Make default"
                hint="Where a one-tap Save goes"
                onPress={() => void run(() => lists.setDefaultList(list.id))}
              />
            )}
            {!isSavedList(list) && (
              <>
                <Row
                  label="Rename"
                  onPress={() => {
                    setRenaming(true);
                    setRenameValue(list.name);
                    setError(undefined);
                  }}
                />
                {confirmingDelete ? (
                  <>
                    <Row label="Confirm delete" onPress={() => void remove()} />
                    <Row label="Keep" onPress={() => setConfirmingDelete(false)} />
                  </>
                ) : (
                  <Row label="Delete list" onPress={() => setConfirmingDelete(true)} />
                )}
              </>
            )}
            <Row label="Close Item Lists" onPress={onSectionBack} last />
          </Card>
        )}

        <SectionTitle text={`Items (${list.itemCount})`} />
        {shown?.error ? (
          <>
            <ErrorText text={shown.error} />
            <LinkButton label="Retry" onPress={() => void reread()} />
          </>
        ) : memberRows ? (
          <Card>
            {/* Plain keyed rows: a virtualized FlatList inside the screen's
                Scroll is exactly the nested-scroll pattern it warns about,
                and these lists are short enough to map directly. */}
            {memberRows.map((item) => (
              <Row
                key={`${item.itemKind}:${item.itemRef}`}
                label={item.surface}
                hint={item.gloss ?? undefined}
                right={
                  <LinkButton
                    label={`Remove ${item.surface}`}
                    onPress={() => void removeMember(item)}
                    disabled={busy}
                    danger
                  />
                }
                last={item === memberRows[memberRows.length - 1]}
              />
            ))}
            {memberRows.length === 0 && <Body text="No items yet." />}
          </Card>
        ) : (
          <Muted text="Loading items…" />
        )}

        <SectionTitle text="Add an item" />
        <Card>
          <ChipRow>
            {KINDS.map((k) => (
              <Chip key={k} label={KIND_LABELS[k]} selected={kind === k} onPress={() => setKind(k)} />
            ))}
          </ChipRow>
        </Card>
        <Field
          label="Reference (dictionary entry sequence or grammar point id)"
          value={itemRef}
          onChangeText={setItemRef}
          onSubmit={() => void addMember()}
          // A Kanji reference is the character itself; word/grammar refs are ids.
          keyboardType={kind === "kanji" ? "default" : "number-pad"}
          disabled={busy}
        />
        <PrimaryButton
          label="Add to list"
          onPress={() => void addMember()}
          disabled={busy || itemRef.trim() === ""}
        />
        {added && <StatusText text="Added." />}
      </Scroll>
    </Screen>
  );
}
