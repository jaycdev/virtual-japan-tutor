import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { StorySettingsSection } from './StorySettingsSection.tsx';
import { createApiClient } from '@vjt/api-client';

interface FakeStorySettings {
  furiganaThresholdSrsLevel: number;
  preferredGenre: string;
  preferredTheme: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mobile StorySettingsSection', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let settings: FakeStorySettings;
  let writes: { method: string; url: string; body?: unknown }[];

  beforeEach(() => {
    settings = { furiganaThresholdSrsLevel: 3, preferredGenre: 'travel', preferredTheme: '' };
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

      if (method === 'GET' && path === '/story-settings') return jsonResponse(settings);
      if (method === 'PUT' && path === '/story-settings') {
        settings = body as FakeStorySettings;
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
    return render(<StorySettingsSection client={client} onBack={() => {}} />);
  }

  it('prefills the stored settings', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByLabelText('Preferred genre')).toBeTruthy();
    });
    expect((screen.getByLabelText('Preferred genre') as HTMLInputElement).value).toBe('travel');
    expect((screen.getByLabelText('Preferred theme') as HTMLInputElement).value).toBe('');
    // 1-9 like web: no 0 chip.
    expect(screen.queryByRole('button', { name: '0' })).toBeNull();
  });

  it('saves a new Furigana Threshold and genre together', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByLabelText('Preferred genre')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.change(screen.getByLabelText('Preferred genre'), {
      target: { value: 'mystery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save story settings' }));

    await waitFor(() => {
      const put = writes.find((w) => w.method === 'PUT');
      expect(put?.url).toContain('/story-settings');
      expect(put?.body).toEqual({
        furiganaThresholdSrsLevel: 5,
        preferredGenre: 'mystery',
        preferredTheme: '',
      });
    });
    await waitFor(() => {
      expect(
        screen.getByText('Saved — the next story written for you uses this.'),
      ).toBeTruthy();
    });
  });

  it('keeps the default threshold when no chip is touched', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByLabelText('Preferred genre')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save story settings' }));

    await waitFor(() => {
      const put = writes.find((w) => w.method === 'PUT');
      expect((put?.body as FakeStorySettings).furiganaThresholdSrsLevel).toBe(3);
    });
  });

  it('surfaces a save failure and keeps the draft', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse(settings));
    fetchMock.mockImplementationOnce(async () => jsonResponse({ message: 'server sad' }, 500));
    renderApp();
    await waitFor(() => {
      expect(screen.getByLabelText('Preferred genre')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Preferred theme'), { target: { value: 'robots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save story settings' }));

    await waitFor(() => {
      expect(screen.getByText('server sad')).toBeTruthy();
    });
    expect((screen.getByLabelText('Preferred theme') as HTMLInputElement).value).toBe('robots');
  });
});
