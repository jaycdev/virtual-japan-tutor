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
  let writes: { method: string; url: string; body?: unknown }[];

  beforeEach(() => {
    status = { configured: true, level: 'N5' };
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
        status = { configured: true, level: (body as { level: string }).level };
        return jsonResponse({ ...status, added: 120, removed: 3 });
      }
      return jsonResponse({ message: `stub: unexpected ${method} ${path}` }, 500);
    });
  });

  function renderApp() {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    return render(<StartingLevelSettings client={client} />);
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
    fetchMock.mockImplementationOnce(async () => jsonResponse(status));
    fetchMock.mockImplementationOnce(async () => jsonResponse({ message: 'nope' }, 500));
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
});
