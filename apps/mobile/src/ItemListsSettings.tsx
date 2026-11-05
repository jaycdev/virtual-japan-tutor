import type { ApiClient, ItemList, ItemListMember } from "@vjt/api-client";
import {
  ITEM_KIND_LABELS,
  ITEM_KINDS,
  isSavedList,
  itemListHint,
  useItemLists,
  type ActionResult,
  type ItemKind,
} from "@vjt/core";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import { useJapaneseFont } from "./japaneseFont/index.tsx";
import { useHardwareBack } from "./useHardwareBack.ts";
import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { Field } from "./components/ui/Field.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { Row } from "./components/ui/Row.tsx";
import { SwitchRow } from "./components/ui/SwitchRow.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { EmptyState, InlineError, Skeleton, SkeletonBar } from "./state/states.tsx";

const KIND_LABELS = ITEM_KIND_LABELS;
const KINDS = ITEM_KINDS;

/** Members as read for one list; null rows mean still loading, error means the read failed. */
interface MembersState {
  listId: string;
  rows: ItemListMember[] | null;
  error?: string;
}

/**
 * Item Lists on the #50 hub (issue #12's management): create and delete
 * lists, rename them, mark one Boosting, choose the Default List, and
 * manage membership — a master list of Cards; tapping one opens its
 * members, each removable, with an "add item" form. Mirrors the web
 * section's rules (Saved is built-in; membership is re-read after every
 * write). The route provides the screen chrome; the master/detail swap and
 * its hardware-Back pop stay here, inside the section.
 */
export function ItemListsSettings({ client }: { client: ApiClient }) {
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
      />
    );
  }

  return <ListsMaster lists={lists} onOpen={setOpenId} />;
}

function ListsMaster({
  lists,
  onOpen,
}: {
  lists: ReturnType<typeof useItemLists>;
  onOpen: (id: string) => void;
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

  if (state.status === "loading") {
    return (
      <View className="gap-4">
        <SkeletonBar width="70%" height={24} />
        <SkeletonBar width="100%" height={64} />
        <SkeletonBar width="100%" height={64} />
      </View>
    );
  }
  if (state.status === "error") {
    return (
      <InlineError
        message={`Cannot load your Item Lists: ${state.message}`}
        onRetry={lists.reload}
      />
    );
  }

  return (
    <View className="gap-4">
      {error ? <InlineError message={error} /> : null}
      <Text className="text-body text-muted-foreground">
        Saving a word from a story adds it to the Default List. A Boosting List also pulls its
        not-yet-known items into your stories’ Focus Sets. Tap a list to manage its items.
      </Text>
      {state.lists.length === 0 && <EmptyState message="No lists yet." compact />}
      {state.lists.map((l) => (
        <Card key={l.id} padded={false}>
          <Row
            label={l.name}
            hint={itemListHint(l)}
            onPress={() => onOpen(l.id)}
            last
          />
        </Card>
      ))}
      <Text className="text-small font-semibold uppercase text-muted-foreground">Add a list</Text>
      <Field
        label="List name"
        value={newName}
        onChangeText={setNewName}
        onSubmit={() => void addList()}
        maxLength={60}
        placeholder="food, travel…"
        disabled={busy}
      />
      <ActionButton
        label="Add list"
        onPress={() => void addList()}
        filled
        disabled={busy || newName.trim() === ""}
      />
    </View>
  );
}

function ItemListDetail({
  lists,
  list,
  isDefault,
  onBackToLists,
}: {
  lists: ReturnType<typeof useItemLists>;
  list: ItemList;
  isDefault: boolean;
  onBackToLists: () => void;
}) {
  const { listItems } = lists;
  const jp = useJapaneseFont();
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
    <View className="gap-4">
      <Text accessibilityRole="header" className={`text-title-sm ${jp.serif} text-foreground`}>
        {list.name}
      </Text>
      <LinkButton label="Close Item Lists" onPress={onBackToLists} />
      {error ? <InlineError message={error} /> : null}

      {renaming ? (
        <View className="gap-4">
          <Field
            label="New name"
            value={renameValue}
            onChangeText={setRenameValue}
            onSubmit={() => void rename()}
            maxLength={60}
            disabled={busy}
          />
          <ActionButton
            label="Save name"
            onPress={() => void rename()}
            filled
            disabled={busy || renameValue.trim() === ""}
          />
          <LinkButton label="Cancel" onPress={() => setRenaming(false)} />
        </View>
      ) : (
        <Card padded={false}>
          <SwitchRow
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
                  <Row label="Keep" onPress={() => setConfirmingDelete(false)} last />
                </>
              ) : (
                <Row label="Delete list" onPress={() => setConfirmingDelete(true)} last />
              )}
            </>
          )}
        </Card>
      )}

      <Text className="text-small font-semibold uppercase text-muted-foreground">
        Items ({list.itemCount})
      </Text>
      {shown?.error ? (
        <>
          <InlineError message={shown.error} onRetry={() => void reread()} />
        </>
      ) : memberRows ? (
        <Card padded={false}>
          {/* Plain keyed rows: a virtualized FlatList inside the screen's
              scroll is exactly the nested-scroll pattern it warns about,
              and these lists are short enough to map directly. */}
          {memberRows.map((item, i) => (
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
              last={i === memberRows.length - 1}
            />
          ))}
          {memberRows.length === 0 && (
            <Text className="px-4 py-3 text-body text-muted-foreground">No items yet.</Text>
          )}
        </Card>
      ) : (
        <Skeleton lines={3} />
      )}

      <Text className="text-small font-semibold uppercase text-muted-foreground">Add an item</Text>
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
      <ActionButton
        label="Add to list"
        onPress={() => void addMember()}
        filled
        disabled={busy || itemRef.trim() === ""}
      />
      {added && (
        <Text role="status" accessibilityLiveRegion="polite" className="text-body text-success">
          Added.
        </Text>
      )}
    </View>
  );
}
