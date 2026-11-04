import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MaruMoriSettings } from './MaruMoriSettings.tsx';
import { formatInstant } from './Today.tsx';
import { createApiClient } from '@vjt/api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const disconnected = { connected: false };
const connected = {
  connected: true,
  counts: {
    kanji: 2_419,
    vocabulary: 8_214,
    vocabularyLinkRate: 0.73,
    lastSyncAt: '2026-11-01T20:12:00Z',
  },
};
const syncRun = {
  id: 'run-1',
  startedAt: '2026-11-02T06:00:00Z',
  status: 'ok',
  counts: { new: 5, levelChanges: 1, disappeared: 0, kanji: 2_419, vocabulary: 8_214 },
};

describe('mobile MaruMoriSettings', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let status: typeof connected | typeof disconnected;
  // The stub records writes: openapi-fetch's Request body can only be read once.
  let writes: { method: string; url: string; body?: unknown }[];

  beforeEach(() => {
    status = disconnected;
    writes = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method !== 'GET') {
        writes.push({
          method: request.method,
          url: request.url as string,
          body: request.body ? await request.clone().json() : undefined,
        });
      }
      if (request.method === 'GET' && path === '/marumori') return jsonResponse(status);
      if (request.method === 'PUT' && path === '/marumori/key') {
        status = connected;
        return jsonResponse({ ok: true });
      }
      if (request.method === 'DELETE' && path === '/marumori/key') {
        status = disconnected;
        return jsonResponse({ ok: true });
      }
      if (request.method === 'POST' && path === '/marumori/sync') return jsonResponse(syncRun);
      return jsonResponse({ message: `stub: unexpected ${request.method} ${path}` }, 500);
    });
  });

  function renderApp(registerSave?: (
    save: (() => Promise<'saved' | 'nothing' | 'blocked'>) | null,
  ) => void) {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    return render(<MaruMoriSettings client={client} registerSave={registerSave} />);
  }

  async function waitForDisconnected() {
    await waitFor(() => {
      expect(screen.getByText('Not connected. Paste your MaruMori API key to connect.')).toBeTruthy();
    });
  }

  it('loads the connection state on mount', async () => {
    renderApp();
    await waitForDisconnected();
    // GET /marumori only.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sync now')).toBeNull();
  });

  it('saves a key through PUT and reconnects, clearing the draft', async () => {
    renderApp();
    await waitForDisconnected();
    fireEvent.change(screen.getByLabelText('MaruMori API key'), {
      target: { value: 'mkmk_2024_key' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => {
      expect(screen.getByText('Connected to MaruMori')).toBeTruthy();
    });
    const put = writes.find((w) => w.method === 'PUT');
    expect(put?.url).toContain('/marumori/key');
    expect(put?.body).toEqual({ apiKey: 'mkmk_2024_key' });
    expect((screen.getByLabelText('MaruMori API key') as HTMLInputElement).value).toBe('');
    expect(await screen.findByText(/Known kanji: 2419/)).toBeTruthy();
    // P5: Last Sync reads as a date, not the raw ISO stamp from the wire.
    expect(
      screen.getByText(`Last Sync ${formatInstant('2026-11-01T20:12:00Z', undefined)}`),
    ).toBeTruthy();
    expect(screen.queryByText(/2026-11-01T20:12:00Z/)).toBeNull();
  });

  it('keeps a typed key masked and never echoes it back as text', async () => {
    renderApp();
    await waitForDisconnected();

    const input = screen.getByLabelText('MaruMori API key') as HTMLInputElement;
    expect(input.type).toBe('password');

    fireEvent.change(input, { target: { value: 'mkmk_2024_secret_token_value' } });

    // The value lives inside the masked control but is never rendered as
    // readable text anywhere on screen.
    expect(input.value).toBe('mkmk_2024_secret_token_value');
    expect(input.type).toBe('password');
    expect(document.body.textContent).not.toContain('mkmk_2024_secret_token_value');

    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => {
      expect(screen.getByText('Connected to MaruMori')).toBeTruthy();
    });
    const put = writes.find((w) => w.method === 'PUT');
    expect(put?.body).toEqual({ apiKey: 'mkmk_2024_secret_token_value' });
  });

  it('shows a validation error inline and keeps the draft', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === 'PUT') {
        const body = await request.json();
        expect(body.apiKey).toBe('short');
        return jsonResponse({ message: 'apiKey: expected at least 20 characters' }, 422);
      }
      return jsonResponse(disconnected);
    });
    renderApp();
    await waitForDisconnected();
    fireEvent.change(screen.getByLabelText('MaruMori API key'), { target: { value: 'short' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => {
      expect(screen.getByText('apiKey: expected at least 20 characters')).toBeTruthy();
    });
    expect((screen.getByLabelText('MaruMori API key') as HTMLInputElement).value).toBe('short');
  });

  it('sync now posts /marumori/sync and reports the run', async () => {
    status = connected;
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Connected to MaruMori')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      expect(
        screen.getByText('Sync complete — 5 new Known Items, 1 level changes, 0 disappeared'),
      ).toBeTruthy();
    });
    const post = writes.find((w) => w.method === 'POST');
    expect(post?.url).toContain('/marumori/sync');
  });

  it('removes the key only after confirming', async () => {
    status = connected;
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Connected to MaruMori')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(writes.some((w) => w.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));

    await waitForDisconnected();
  });

  it('the step save registered with the wizard connects a typed key, and reports nothing when none is typed (S2)', async () => {
    let stepSave: (() => Promise<'saved' | 'nothing' | 'blocked'>) | null = null;
    renderApp((save) => {
      stepSave = save;
    });
    await waitForDisconnected();
    expect(stepSave).toBeTruthy();

    await expect(stepSave!()).resolves.toBe('nothing');
    expect(writes.some((w) => w.method === 'PUT')).toBe(false);

    fireEvent.change(screen.getByLabelText('MaruMori API key'), {
      target: { value: 'mkmk_2024_key' },
    });
    await expect(stepSave!()).resolves.toBe('saved');
    const put = writes.find((w) => w.method === 'PUT');
    expect(put?.url).toContain('/marumori/key');
    expect(put?.body).toEqual({ apiKey: 'mkmk_2024_key' });
    // Same contract as Connect: the draft is cleared once it lands.
    await waitFor(() => {
      expect((screen.getByLabelText('MaruMori API key') as HTMLInputElement).value).toBe('');
    });
  });
});
