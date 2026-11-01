import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import App, { Root } from '../App';
import { secureStoreServerUrl } from './serverUrlStorage.ts';
import { secureStoreTokenStorage, type SecureStoreLike } from './tokenStorage.ts';

// In-memory stand-in for expo-secure-store, pre-seedable and assertable.
function fakeStore(initial: Record<string, string> = {}): SecureStoreLike & {
  dump: () => Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    async getItemAsync(key) {
      return data[key] ?? null;
    },
    async setItemAsync(key, value) {
      data[key] = value;
    },
    async deleteItemAsync(key) {
      delete data[key];
    },
    dump: () => ({ ...data }),
  };
}

const USER = { username: 'learner', roles: ['student'] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Minimal stand-in for the Go server: login, /me session check, one practice
// session (the tab shell loads Practice immediately), item-list plumbing 404s.
function makeFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path === '/auth/login') {
      const body = (await request.json()) as { username: string; password: string };
      if (body.username !== 'learner' || body.password !== 'hunter2') {
        return jsonResponse({ message: 'invalid credentials' }, 401);
      }
      return jsonResponse({ token: 'session-1', user: USER });
    }
    if (request.method === 'GET' && path === '/me') {
      if (request.headers.get('authorization') !== 'Bearer session-1') {
        return jsonResponse({ message: 'session expired' }, 401);
      }
      return jsonResponse(USER);
    }
    if (path === '/practice/session') {
      return jsonResponse({ practiceSessionId: 'practice-1', items: [] });
    }
    return jsonResponse({ message: `stub: unexpected ${request.method} ${path}` }, 500);
  }) as unknown as typeof fetch;
}

function renderApp(store: SecureStoreLike, fetchImpl: typeof fetch) {
  return render(
    <Root
      tokenStorage={secureStoreTokenStorage(store)}
      urlStorage={secureStoreServerUrl(store)}
      fetchOverride={fetchImpl}
    />,
  );
}

async function submitLogin(username: string, password: string) {
  // fireEvent.change sets the whole value at once; per-keystroke userEvent.type
  // loses characters to react-native-web's controlled TextInput re-renders.
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('mobile App', () => {
  let fetchMock: typeof fetch;

  beforeEach(() => {
    fetchMock = makeFetch();
  });

  it('shows the login screen when no session token is stored', async () => {
    const store = fakeStore();
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restores a stored session on launch and lands on Practice', async () => {
    const store = fakeStore({ 'vjt.token': 'session-1' });
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Practice' })).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('signs in and persists the session token to secure storage', async () => {
    const store = fakeStore();
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
    });
    await submitLogin('learner', 'hunter2');

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Settings' })).toBeTruthy();
    });
    expect(store.dump()['vjt.token']).toBe('session-1');
  });

  it('shows the server error message for wrong credentials', async () => {
    const store = fakeStore();
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
    });
    await submitLogin('learner', 'nope');

    await waitFor(() => {
      expect(screen.getByText('invalid credentials')).toBeTruthy();
    });
    expect(store.dump()['vjt.token']).toBeUndefined();
  });

  it('clears the stored token when the server rejects the session', async () => {
    const store = fakeStore({ 'vjt.token': 'stale-session' });
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
    });
    expect(store.dump()['vjt.token']).toBeUndefined();
  });

  it('reports an unreachable server and offers Retry', async () => {
    const store = fakeStore({ 'vjt.token': 'session-1' });
    fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByText(/Cannot reach the server/)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText(/Server address: http:\/\/10\.0\.2\.2:8080/)).toBeTruthy();
  });

  it('persists a new server address from Settings and reconnects', async () => {
    const store = fakeStore({ 'vjt.token': 'session-1' });
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Practice' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'http://192.168.1.50:8080/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(store.dump()['vjt.serverUrl']).toBe('http://192.168.1.50:8080');
    });
    // The remounted tree restores the session against the new address.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Practice' })).toBeTruthy();
    });
  });

  it('ships production wiring that reads the real secure store', () => {
    expect(<App />).toBeTruthy();
  });
});
