import type { ApiClient, ItemList, ItemListMember } from "@vjt/api-client";
import {
  ITEM_KINDS,
  isSavedList,
  itemListHint,
  useItemLists,
  useT,
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
import { T } from "./components/Text.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { EmptyState, InlineError, Skeleton, SkeletonBar } from "./state/states.tsx";

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
  const { language, tp } = useT();
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
        message={tp("mobile.listsLoadFailed", { message: state.message })}
        onRetry={lists.reload}
      />
    );
  }

  return (
    <View className="gap-4">
      {error ? <InlineError message={error} /> : null}
      <T k="mobile.listsIntro" className="text-body text-muted-foreground" />
      {state.lists.length === 0 && <EmptyState message={tp("lists.empty")} compact />}
      {state.lists.map((l) => (
        <Card key={l.id} padded={false}>
          <Row
            label={l.name}
            hint={itemListHint(l, language)}
            onPress={() => onOpen(l.id)}
            last
          />
        </Card>
      ))}
      <T k="lists.addHeading" className="text-small font-semibold uppercase text-muted-foreground" />
      <Field
        label={<T k="lists.nameLabel" className="text-small text-muted-foreground" />}
        value={newName}
        onChangeText={setNewName}
        onSubmit={() => void addList()}
        maxLength={60}
        placeholder={tp("lists.namePlaceholder")}
        disabled={busy}
      />
      <ActionButton
        label={<T k="lists.addSubmit" className="text-body font-semibold text-primary-foreground" />}
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
  const { tp } = useT();
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
      <Text accessibilityRole="header" className={`text-title-sm ${jp.regular} text-foreground`}>
        {list.name}
      </Text>
      <LinkButton
        label={<T k="mobile.closeItemLists" className="text-body text-primary" />}
        onPress={onBackToLists}
      />
      {error ? <InlineError message={error} /> : null}

      {renaming ? (
        <View className="gap-4">
          <Field
            label={<T k="lists.renameLabel" className="text-small text-muted-foreground" />}
            value={renameValue}
            onChangeText={setRenameValue}
            onSubmit={() => void rename()}
            maxLength={60}
            disabled={busy}
          />
          <ActionButton
            label={<T k="lists.saveName" className="text-body font-semibold text-primary-foreground" />}
            onPress={() => void rename()}
            filled
            disabled={busy || renameValue.trim() === ""}
          />
          <LinkButton
            label={<T k="common.cancel" className="text-body text-primary" />}
            onPress={() => setRenaming(false)}
          />
        </View>
      ) : (
        <Card padded={false}>
          <SwitchRow
            label={<T k="lists.boostingLabel" className="text-body text-foreground" />}
            hint={<T k="mobile.boostingHint" className="text-small text-muted-foreground" />}
            value={list.boosting}
            disabled={busy}
            onToggle={(boosting) => void run(() => lists.updateList(list.id, { boosting }))}
          />
          {isDefault ? (
            <Row
              label={<T k="mobile.defaultListLabel" className="text-body text-foreground" />}
              hint={<T k="mobile.defaultListHint" className="text-small text-muted-foreground" />}
            />
          ) : (
            <Row
              label={<T k="lists.makeDefault" className="text-body text-foreground" />}
              hint={<T k="mobile.makeDefaultHint" className="text-small text-muted-foreground" />}
              onPress={() => void run(() => lists.setDefaultList(list.id))}
            />
          )}
          {!isSavedList(list) && (
            <>
              <Row
                label={<T k="common.rename" className="text-body text-foreground" />}
                onPress={() => {
                  setRenaming(true);
                  setRenameValue(list.name);
                  setError(undefined);
                }}
              />
              {confirmingDelete ? (
                <>
                  <Row
                    label={<T k="common.confirmDelete" className="text-body text-foreground" />}
                    onPress={() => void remove()}
                  />
                  <Row
                    label={<T k="stories.deleteKeep" className="text-body text-foreground" />}
                    onPress={() => setConfirmingDelete(false)}
                    last
                  />
                </>
              ) : (
                <Row
                  label={<T k="lists.deleteList" className="text-body text-foreground" />}
                  onPress={() => setConfirmingDelete(true)}
                  last
                />
              )}
            </>
          )}
        </Card>
      )}

      <T
        k="lists.itemsHeading"
        params={{ count: list.itemCount }}
        className="text-small font-semibold uppercase text-muted-foreground"
      />
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
                  label={tp("lists.removeAria", { surface: item.surface })}
                  onPress={() => void removeMember(item)}
                  disabled={busy}
                  danger
                />
              }
              last={i === memberRows.length - 1}
            />
          ))}
          {memberRows.length === 0 && (
            <T
              k="lists.itemsEmpty"
              className="px-4 py-3 text-body text-muted-foreground"
            />
          )}
        </Card>
      ) : (
        <Skeleton lines={3} />
      )}

      <T k="lists.addItemHeading" className="text-small font-semibold uppercase text-muted-foreground" />
      <Card>
        <ChipRow>
          {KINDS.map((k) => (
            <Chip
              key={k}
              label={
                <T
                  k={k === "kanji" ? "item.kanji" : k === "vocabulary" ? "item.vocabulary" : "item.grammar"}
                  className={`text-body ${kind === k ? "font-semibold text-primary" : "text-foreground"}`}
                />
              }
              selected={kind === k}
              onPress={() => setKind(k)}
            />
          ))}
        </ChipRow>
      </Card>
      <Field
        label={<T k="lists.refLabel" className="text-small text-muted-foreground" />}
        value={itemRef}
        onChangeText={setItemRef}
        onSubmit={() => void addMember()}
        // A Kanji reference is the character itself; word/grammar refs are ids.
        keyboardType={kind === "kanji" ? "default" : "number-pad"}
        disabled={busy}
      />
      <ActionButton
        label={<T k="lists.addToSubmit" className="text-body font-semibold text-primary-foreground" />}
        onPress={() => void addMember()}
        filled
        disabled={busy || itemRef.trim() === ""}
      />
      {added && (
        <View accessibilityLiveRegion="polite">
          <T k="lists.added" className="text-body text-success" />
        </View>
      )}
    </View>
  );
}
