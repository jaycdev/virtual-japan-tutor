import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

/**
 * The save flow probes the CANDIDATE address with the plain global fetch
 * (the client still points at the old server), so tests stub the global.
 * `answer` decides what the probe returns; the default is a healthy server.
 */
function stubProbe(answer?: (url: URL) => Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (answer) return answer(url);
    return jsonResponse({ status: 'ok', database: 'connected' });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('mobile ServerSettings', () => {
  beforeEach(() => {
    healthBody = { status: 'ok', database: 'connected' };
    // Saves probe the candidate first; default: it answers healthy, so the
    // happy path reaches onSave.
    stubProbe();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the current URL and saves a normalized override', async () => {
    const saved: string[] = [];
    const onSave = vi.fn(async (url: string) => {
      saved.push(url);
    });
    const probe = stubProbe();
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
    // The probe was aimed at the candidate, not the current address (S1).
    expect(probe.mock.calls.map((call) => String(call[0]))).toContain(
      'http://192.168.1.50:8080/health',
    );
    // No "saved" banner: on a real URL change this screen unmounts when the
    // tree rebuilds against the new address, so any success message here would
    // fire post-unmount or lie when the address did not actually change.
    expect(screen.queryByText(/Saved/)).toBeNull();
  });

  it('a candidate that does not answer is refused and the current address stays (S1)', async () => {
    const onSave = vi.fn(async () => {});
    stubProbe(async () => {
      throw new TypeError('fetch failed'); // connection refused, DNS miss, abort…
    });
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://10.0.2.2:8080" onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'http://192.168.1.50:8080' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(
        screen.getByText(/That address did not answer\. Check the host and port/),
      ).toBeTruthy();
    });
    expect(onSave).not.toHaveBeenCalled();
    // Still on the old address, field untouched, and the app says so.
    expect(screen.getByText('Currently: http://10.0.2.2:8080')).toBeTruthy();
  });

  it('a candidate that answers but is not the app is refused too (S1)', async () => {
    const onSave = vi.fn(async () => {});
    stubProbe(async () => jsonResponse({ message: 'nope' }, 404));
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://10.0.2.2:8080" onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'http://192.168.1.50:8080' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(screen.getByText(/answered 404 instead of a healthy \/health/)).toBeTruthy();
    });
    expect(onSave).not.toHaveBeenCalled();
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

  it('shows the server version from /health', async () => {
    healthBody = { status: 'ok', database: 'connected', version: '1.2.3' };
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://10.0.2.2:8080" onSave={async () => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Server version: 1.2.3')).toBeTruthy();
    });
  });

  it('shows "unknown" when /health carries no version', async () => {
    const client = makeClient(healthFetch());
    render(<ServerSettings client={client} currentUrl="http://10.0.2.2:8080" onSave={async () => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Server version: unknown')).toBeTruthy();
    });
  });
});
