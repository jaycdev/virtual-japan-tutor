import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ReadingSettingsSection } from './ReadingSettingsSection.tsx';
import { createApiClient } from '@vjt/api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mobile ReadingSettingsSection', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let settings: { blurTranslation: boolean; lookupHoldMs: number };
  let writes: { method: string; url: string; body?: unknown }[];

  beforeEach(() => {
    settings = { blurTranslation: true, lookupHoldMs: 800 };
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

      if (method === 'GET' && path === '/reading-settings') return jsonResponse(settings);
      if (method === 'PUT' && path === '/reading-settings') {
        settings = { ...settings, ...(body as typeof settings) };
        return jsonResponse(settings);
      }
      return jsonResponse({ message: `stub: unexpected ${method} ${path}` }, 500);
    });
  });

  function renderApp() {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    return render(<ReadingSettingsSection client={client} onBack={() => {}} />);
  }

  async function waitForLoaded() {
    await waitFor(() => {
      expect(
        screen.getByLabelText('Lookup hold before a Weak Signal (ms, 0–10000)'),
      ).toBeTruthy();
    });
  }

  it('shows the stored hold threshold', async () => {
    renderApp();
    await waitForLoaded();
    const field = screen.getByLabelText(
      'Lookup hold before a Weak Signal (ms, 0–10000)',
    ) as HTMLInputElement;
    expect(field.value).toBe('800');
  });

  it('saves a new threshold, keeping the blur toggle as stored', async () => {
    renderApp();
    await waitForLoaded();

    fireEvent.change(
      screen.getByLabelText('Lookup hold before a Weak Signal (ms, 0–10000)'),
      { target: { value: '1500' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save reading settings' }));

    await waitFor(() => {
      const put = writes.find((w) => w.method === 'PUT');
      expect(put?.url).toContain('/reading-settings');
      expect(put?.body).toEqual({ blurTranslation: true, lookupHoldMs: 1500 });
    });
    await waitFor(() => {
      expect(
        screen.getByText('Saved — the reader uses this from the next lookup on.'),
      ).toBeTruthy();
    });
  });

  it('rejects an out-of-range hold before hitting the network', async () => {
    renderApp();
    await waitForLoaded();
    const writesBefore = writes.length;

    fireEvent.change(
      screen.getByLabelText('Lookup hold before a Weak Signal (ms, 0–10000)'),
      { target: { value: '99999' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save reading settings' }));

    await waitFor(() => {
      expect(
        screen.getByText('The hold is a whole number of milliseconds from 0 to 10000.'),
      ).toBeTruthy();
    });
    // Only the mount GET happened: the client-side check stopped the PUT.
    expect(writes).toHaveLength(writesBefore);
  });

  it('accepts zero — every lookup counts as a signal', async () => {
    renderApp();
    await waitForLoaded();

    fireEvent.change(
      screen.getByLabelText('Lookup hold before a Weak Signal (ms, 0–10000)'),
      { target: { value: '0' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save reading settings' }));

    await waitFor(() => {
      const put = writes.find((w) => w.method === 'PUT');
      expect((put?.body as { lookupHoldMs: number }).lookupHoldMs).toBe(0);
    });
  });
});
