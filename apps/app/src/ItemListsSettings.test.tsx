import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fakeBackHandler } from '../test/back-handler-fake.ts';
import { setBackHandlerForTests } from './useHardwareBack.ts';
import { ItemListsSettings } from './ItemListsSettings.tsx';
import { createApiClient } from '@vjt/api-client';

interface FakeList {
  id: string;
  name: string;
  itemCount: number;
  boosting: boolean;
  isDefault: boolean;
}
interface FakeMember {
  itemKind: string;
  itemRef: string;
  surface: string;
  gloss: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const noContent = () => new Response(null, { status: 204 });

describe('mobile ItemListsSettings', () => {
  afterEach(() => setBackHandlerForTests(undefined));

  let fetchMock: ReturnType<typeof vi.fn>;
  let lists: FakeList[];
  let members: Record<string, FakeMember[]>;
  let calls: { method: string; url: string; body?: unknown }[];

  beforeEach(() => {
    lists = [
      { id: 'list-1', name: 'Saved', itemCount: 3, boosting: false, isDefault: true },
      { id: 'list-2', name: 'Textbook ch. 1', itemCount: 1, boosting: true, isDefault: false },
    ];
    members = {
      'list-2': [{ itemKind: 'vocabulary', itemRef: '77', surface: '水', gloss: 'water' }],
    };
    calls = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const method = request.method.toUpperCase();
      const url = new URL(request.url);
      const path = url.pathname;
      // openapi-fetch hands fetch a single Request: the body lives on it, not in init.
      let body: unknown;
      if (request.body) {
        try {
          body = await request.clone().json();
        } catch {
          body = undefined;
        }
      }
      calls.push({ method, url: request.url as string, body });

      if (method === 'GET' && path === '/item-lists') {
        const def = lists.find((l) => l.isDefault);
        return jsonResponse({ items: lists, defaultListId: def?.id ?? null });
      }
      if (method === 'POST' && path === '/item-lists') {
        lists.push({
          id: `list-${lists.length + 1}`,
          name: (body as { name: string }).name,
          itemCount: 0,
          boosting: (body as { boosting?: boolean }).boosting ?? false,
          isDefault: false,
        });
        return jsonResponse(lists[lists.length - 1], 201);
      }
      if (path === '/item-lists/default' && method === 'PUT') {
        const target = (body as { listId: string }).listId;
        for (const l of lists) l.isDefault = l.id === target;
        return noContent();
      }
      const listMatch = path.match(/^\/item-lists\/(list-\d+)$/);
      if (listMatch) {
        const list = lists.find((l) => l.id === listMatch[1]);
        if (!list) return jsonResponse({ message: 'not found' }, 404);
        if (method === 'PUT') {
          Object.assign(list, body);
          return jsonResponse(list);
        }
        if (method === 'DELETE') {
          lists = lists.filter((l) => l.id !== list.id);
          return noContent();
        }
      }
      const itemsMatch = path.match(/^\/item-lists\/(list-\d+)\/items$/);
      if (itemsMatch) {
        const list = lists.find((l) => l.id === itemsMatch[1]);
        if (!list) return jsonResponse({ message: 'not found' }, 404);
        if (method === 'GET') return jsonResponse({ items: members[list.id] ?? [] });
        if (method === 'POST') {
          const { itemKind, itemRef } = body as { itemKind: string; itemRef: string };
          members[list.id] = [
            ...(members[list.id] ?? []),
            { itemKind, itemRef, surface: `added-${itemRef}`, gloss: 'new' },
          ];
          list.itemCount += 1;
          return noContent();
        }
        if (method === 'DELETE') {
          const ref = url.searchParams.get('itemRef');
          const kind = url.searchParams.get('itemKind');
          members[list.id] = (members[list.id] ?? []).filter(
            (m) => !(m.itemRef === ref && m.itemKind === kind),
          );
          list.itemCount -= 1;
          return noContent();
        }
      }
      return jsonResponse({ message: `stub: unexpected ${method} ${path}` }, 500);
    });
  });

  function renderApp() {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    return render(<ItemListsSettings client={client} onBack={() => {}} />);
  }

  async function openList(name: string) {
    await waitFor(() => {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name }));
  }

  it('lists every list with default/boosting hints and item counts', async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText('default · 3 items')).toBeTruthy();
    });
    expect(screen.getByText('1 item · boosting')).toBeTruthy();
  });

  it('creates a new list and clears the draft', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Anki core' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add list' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Anki core' })).toBeTruthy();
    });
    expect((screen.getByLabelText('List name') as HTMLInputElement).value).toBe('');
  });

  it('keeps the built-in Saved list rename/delete-free', async () => {
    renderApp();
    await openList('Saved');

    expect(screen.getByRole('switch', { name: 'Boosting' })).toBeTruthy();
    expect(screen.getByText('Default list')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete list' })).toBeNull();
  });

  it('toggles boosting with one PUT', async () => {
    renderApp();
    await openList('Saved');

    fireEvent.click(screen.getByRole('switch', { name: 'Boosting' }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put?.url).toContain('/item-lists/list-1');
      expect(put?.body).toEqual({ boosting: true });
    });
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'GET')).toBe(true);
    });
  });

  it('makes another list the default', async () => {
    renderApp();
    await openList('Textbook ch. 1');

    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));

    await waitFor(() => {
      const put = calls.find((c) => c.url.includes('/item-lists/default'));
      expect(put?.body).toEqual({ listId: 'list-2' });
    });
    await waitFor(() => {
      expect(screen.getByText('Default list')).toBeTruthy();
    });
  });

  it('removes a member from the open list', async () => {
    renderApp();
    await openList('Textbook ch. 1');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove 水' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove 水' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/items?'))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Remove 水' })).toBeNull();
    });
    expect(screen.getByText('No items yet.')).toBeTruthy();
  });

  it('adds an item by reference with the kind chips', async () => {
    renderApp();
    await openList('Textbook ch. 1');

    // Vocabulary is the default chip; just type a reference.
    fireEvent.change(
      screen.getByLabelText('Reference (dictionary entry sequence or grammar point id)'),
      { target: { value: '123' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/items'));
      expect(post?.body).toEqual({ itemKind: 'vocabulary', itemRef: '123' });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove added-123' })).toBeTruthy();
    });
  });

  it('lets a Kanji reference be typed as the character itself', async () => {
    renderApp();
    await openList('Textbook ch. 1');

    const field = screen.getByLabelText(
      'Reference (dictionary entry sequence or grammar point id)',
    ) as HTMLInputElement;
    // Word refs are ids: a numeric keyboard. Kanji refs are characters: not.
    expect(field.getAttribute('inputmode')).toBe('numeric');
    fireEvent.click(screen.getByRole('button', { name: 'Kanji' }));
    expect(field.getAttribute('inputmode')).not.toBe('numeric');

    fireEvent.change(field, { target: { value: '水' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/items'));
      expect(post?.body).toEqual({ itemKind: 'kanji', itemRef: '水' });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove added-水' })).toBeTruthy();
    });
  });

  it('renames through an inline edit', async () => {
    renderApp();
    await openList('Textbook ch. 1');

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('New name') as HTMLInputElement;
    expect(input.value).toBe('Textbook ch. 1');
    fireEvent.change(input, { target: { value: 'Textbook ch. 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/item-lists/list-2'));
      expect(put?.body).toEqual({ name: 'Textbook ch. 2' });
    });
    // The Title keeps accessibilityRole="header" for native, but
    // react-native-web does not emit a header role, so assert on the text.
    await waitFor(() => {
      expect(screen.getByText('Textbook ch. 2')).toBeTruthy();
    });
  });

  it('deletes a custom list only after confirming', async () => {
    renderApp();
    await openList('Textbook ch. 1');

    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    // A stray delete before confirming has not happened:
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/item-lists/list-2'))).toBe(
        true,
      );
    });
    // Back on the master view: only the built-in list remains.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Textbook ch. 1' })).toBeNull();
  });

  it('pops an open list back to the master view on hardware Back', async () => {
    const back = fakeBackHandler();
    setBackHandlerForTests(back);
    renderApp();
    await openList('Textbook ch. 1');

    expect(screen.getByRole('button', { name: 'Close Item Lists' })).toBeTruthy();
    expect(back.press()).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
    });
    // Master view again: no listener, so Android's default (leave the app) stands.
    expect(back.press()).toBe(false);
  });
});
