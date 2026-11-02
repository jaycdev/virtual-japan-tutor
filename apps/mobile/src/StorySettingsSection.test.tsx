import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { StorySettingsSection } from './StorySettingsSection.tsx';
import { createApiClient } from '@vjt/api-client';

interface FakeStorySettings {
  furiganaThresholdSrsLevel: number;
  preferredGenre: string;
  preferredTheme: string;
  timezone: string;
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
  let failNextPut = false;

  beforeEach(() => {
    settings = {
      furiganaThresholdSrsLevel: 3,
      preferredGenre: 'travel',
      preferredTheme: '',
      timezone: 'America/Los_Angeles',
    };
    writes = [];
    failNextPut = false;
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
        if (failNextPut) {
          failNextPut = false;
          return jsonResponse({ message: 'server sad' }, 500);
        }
        settings = body as FakeStorySettings;
        return jsonResponse(settings);
      }
      // Suggestions for the genre/theme autocompletes (issue #34); the
      // generation hook of the same screen reads its snapshot too.
      if (method === 'GET' && path === '/stories/suggestions') {
        return jsonResponse({ genres: ['mystery', 'diary'], themes: ['robots', 'cooking'] });
      }
      if (method === 'GET' && path === '/stories/generation') {
        return jsonResponse({ status: 'idle', percent: 0 });
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
    expect((screen.getByLabelText('Timezone') as HTMLInputElement).value).toBe('America/Los_Angeles');
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
        timezone: 'America/Los_Angeles',
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

  it('autocompletes the preferred genre and theme from the story list', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByLabelText('Preferred genre')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Preferred genre'), { target: { value: 'mys' } });
    fireEvent.click(await screen.findByRole('button', { name: 'mystery' }));
    expect((screen.getByLabelText('Preferred genre') as HTMLInputElement).value).toBe('mystery');

    fireEvent.change(screen.getByLabelText('Preferred theme'), { target: { value: 'coo' } });
    fireEvent.click(await screen.findByRole('button', { name: 'cooking' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save story settings' }));
    await waitFor(() => {
      const put = writes.find((w) => w.method === 'PUT');
      expect((put?.body as FakeStorySettings).preferredGenre).toBe('mystery');
      expect((put?.body as FakeStorySettings).preferredTheme).toBe('cooking');
    });
  });

  it('autocompletes the timezone and offers the device one', async () => {
    renderApp();
    await waitFor(() => {
      expect(screen.getByLabelText('Timezone')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'seou' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Asia/Seoul' }));
    expect((screen.getByLabelText('Timezone') as HTMLInputElement).value).toBe('Asia/Seoul');

    fireEvent.click(screen.getByRole('button', { name: 'Use my device’s timezone' }));
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect((screen.getByLabelText('Timezone') as HTMLInputElement).value).toBe(device);

    fireEvent.click(screen.getByRole('button', { name: 'Save story settings' }));
    await waitFor(() => {
      const put = writes.find((w) => w.method === 'PUT');
      expect((put?.body as FakeStorySettings).timezone).toBe(device);
    });
  });

  it('surfaces a save failure and keeps the draft', async () => {
    failNextPut = true;
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
