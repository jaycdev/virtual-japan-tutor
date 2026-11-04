import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Platform } from 'react-native';

import { ServerSettings } from './ServerSettings.tsx';
import { createApiClient } from '@vjt/api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** /health answers ok unless a test overrides the payload. */
let healthBody: unknown = { status: 'ok', database: 'connected' };

function makeClient(fetchMock: ReturnType<typeof vi.fn>) {
  return createApiClient({
    baseUrl: 'http://localhost',
    fetch: fetchMock as unknown as typeof fetch,
  });
}

function healthFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(new Request(input).url).pathname;
    if (path === '/health') return jsonResponse(healthBody);
    return jsonResponse({ message: `stub: unexpected ${path}` }, 500);
  });
}

describe('mobile ServerSettings (web)', () => {
  // jsdom + react-native-web: Platform.OS === 'web', the shipped web build.
  it('shows the health check and no address editor', async () => {
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://localhost:8080" onSave={async () => {}} />);

    await waitFor(() => {
      expect(
        screen.getByText('The server is reachable and its database is connected.'),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(
        'This build is served by the Virtual Japan Tutor server itself — the address comes from the page.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Server address')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save server' })).toBeNull();
  });
});

describe('mobile ServerSettings (Android)', () => {
  const realOS = Platform.OS;
  beforeEach(() => {
    // The address editor only exists where there is no same-origin default.
    (Platform as { OS: string }).OS = 'android';
    healthBody = { status: 'ok', database: 'connected' };
  });
  afterEach(() => {
    (Platform as { OS: string }).OS = realOS;
  });

  it('shows the current URL and saves a normalized override', async () => {
    const saved: string[] = [];
    const onSave = vi.fn(async (url: string) => {
      saved.push(url);
    });
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://10.0.2.2:8080" onSave={onSave} />);

    expect(screen.getByText('Currently: http://10.0.2.2:8080')).toBeTruthy();
    const input = screen.getByLabelText('Server address') as HTMLInputElement;
    expect(input.value).toBe('http://10.0.2.2:8080');

    fireEvent.change(input, { target: { value: 'http://192.168.1.50:8080/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(saved).toEqual(['http://192.168.1.50:8080']);
    });
    // No "saved" banner: on a real URL change this screen unmounts when the
    // tree rebuilds against the new address, so any success message here would
    // fire post-unmount or lie when the address did not actually change.
    expect(screen.queryByText(/Saved/)).toBeNull();
  });

  it('rejects an invalid URL without saving', async () => {
    const onSave = vi.fn(async () => {});
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://10.0.2.2:8080" onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(screen.getByText('Enter the full address, like http://192.168.1.10:8080')).toBeTruthy();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers the emulator default back', async () => {
    const onSave = vi.fn(async () => {});
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://192.168.1.50:8080" onSave={onSave} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Use the emulator default (http://10.0.2.2:8080)' }),
    );
    expect((screen.getByLabelText('Server address') as HTMLInputElement).value).toBe(
      'http://10.0.2.2:8080',
    );
  });

  it('reads connection health and can re-check it', async () => {
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://10.0.2.2:8080" onSave={async () => {}} />);

    await waitFor(() => {
      expect(
        screen.getByText('The server is reachable and its database is connected.'),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => {
      expect(
        screen.getByText('The server is reachable and its database is connected.'),
      ).toBeTruthy();
    });
  });
});
