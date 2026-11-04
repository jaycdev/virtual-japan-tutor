import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { StartingLevelSettings } from './StartingLevelSettings.tsx';
import { createApiClient } from '@vjt/api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mobile StartingLevelSettings', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let status: { configured: boolean; level: string | null };
  let reviewItems: unknown[];
  let failLevelPut = false;
  let writes: { method: string; url: string; body?: unknown }[];

  beforeEach(() => {
    status = { configured: true, level: 'N5' };
    reviewItems = [];
    failLevelPut = false;
    writes = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const method = request.method.toUpperCase();
      const path = new URL(request.url).pathname;
      let body: unknown;
      if (request.body) {
        try {
          body = await request.clone().json();
        } catch {
          body = undefined;
        }
      }
      writes.push({ method, url: request.url as string, body });

      if (method === 'GET' && path === '/starting-level') return jsonResponse(status);
      if (method === 'PUT' && path === '/starting-level') {
        if (failLevelPut) return jsonResponse({ message: 'nope' }, 500);
        status = { configured: true, level: (body as { level: string }).level };
        return jsonResponse({ ...status, added: 120, removed: 3 });
      }
      if (method === 'GET' && path === '/grammar/review') return jsonResponse(reviewItems);
      return jsonResponse({ message: `stub: unexpected ${method} ${path}` }, 500);
    });
  });

  function renderApp(saveHandle?: {
    current: (() => Promise<"saved" | "nothing" | "blocked">) | null;
  }) {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    return render(<StartingLevelSettings client={client} saveHandle={saveHandle} />);
  }

  it('shows the stored level with all five choices', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Starting level: N5')).toBeTruthy();
    });
    for (const level of ['N5', 'N4', 'N3', 'N2', 'N1']) {
      expect(screen.getByRole('button', { name: level })).toBeTruthy();
    }
  });

  it('says so when no level has been chosen yet', async () => {
    status = { configured: false, level: null };
    renderApp();
    await waitFor(() => {
      expect(
        screen.getByText('Not chosen yet. Pick one to mark everything at or below it as known.'),
      ).toBeTruthy();
    });
  });

  it('saves a new level and reports the Seeded Grammar change', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Starting level: N5')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'N4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save level' }));

    await waitFor(() => {
      const put = writes.find((w) => w.method === 'PUT');
      expect(put?.url).toContain('/starting-level');
      expect(put?.body).toEqual({ level: 'N4' });
    });
    await waitFor(() => {
      expect(screen.getByText('Grammar updated: 120 added, 3 removed.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('Starting level: N4')).toBeTruthy();
    });
  });

  it('shows a server failure and stays on the picker', async () => {
    failLevelPut = true;
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Starting level: N5')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'N3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save level' }));

    await waitFor(() => {
      expect(screen.getByText('nope')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Save level' })).toBeTruthy();
  });

  it('the wizard save handle writes the picked chip, and reports nothing when none is picked (S2)', async () => {
    status = { configured: false, level: null };
    const saveHandle: {
      current: (() => Promise<'saved' | 'nothing' | 'blocked'>) | null;
    } = { current: null };
    renderApp(saveHandle);
    await screen.findByRole("button", { name: 'N4' });
    expect(saveHandle.current).toBeTruthy();

    // No pick yet: nothing to write, and the wizard is free to move on.
    await expect(saveHandle.current!()).resolves.toBe('nothing');
    expect(writes.some((w) => w.method === 'PUT')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'N4' }));
    await expect(saveHandle.current!()).resolves.toBe('saved');
    const put = writes.find((w) => w.method === 'PUT');
    expect(put?.url).toContain('/starting-level');
    expect(put?.body).toEqual({ level: 'N4' });
  });

  it('lists flagged grammar matches read-only under the picker (S5)', async () => {
    reviewItems = [
      { marumoriId: 'Grammar/6578', pattern: '～にちかい', jlptLevel: 'N4', flagged: true },
      { marumoriId: 'Grammar/7001', pattern: '～ておいたほうがいい', matchedPointId: 412, flagged: true },
    ];
    renderApp();

    const heading = await screen.findByRole('heading', { name: 'Review these grammar matches' });
    expect(heading).toBeTruthy();
    expect(
      await screen.findByText(
        'These MaruMori grammar points did not match the Catalogue cleanly. They re-check themselves on later Syncs.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('～にちかい (MaruMori level N4) — no Grammar Catalogue match')).toBeTruthy();
    expect(screen.getByText('～ておいたほうがいい — matched point 412, level was ambiguous')).toBeTruthy();
    // Read-only: the list issues no writes.
    expect(writes.some((w) => w.method !== 'GET')).toBe(false);
  });

  it('says so when the review list is empty (S5)', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Review these grammar matches' });
    expect(await screen.findByText('Nothing needs a second look.')).toBeTruthy();
  });
});
