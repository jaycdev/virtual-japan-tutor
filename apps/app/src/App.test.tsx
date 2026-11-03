import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Platform } from 'react-native';

import App, { AppBootstrapped } from '../App';
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

interface LoggedRequest {
  url: string;
  method: string;
  authorization: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Minimal stand-in for the Go server: login, the /me session check, and
// logout. The signed-in content is just a probe marker here — what routes
// render is the app-shell test's job — so no screen endpoints are needed.
function makeFetch(log: LoggedRequest[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    log.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
    });
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
    if (request.method === 'POST' && path === '/auth/logout') {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ message: `stub: unexpected ${request.method} ${path}` }, 500);
  }) as unknown as typeof fetch;
}

// The signed-in content placeholder (what _layout puts in its place: the
// router tree); its presence proves AuthGate let the children through.
const PROBE = <span>signed-in-tree</span>;

function renderApp(store: SecureStoreLike, fetchImpl: typeof fetch, children = PROBE) {
  return render(
    <AppBootstrapped
      tokenStorage={secureStoreTokenStorage(store)}
      urlStorage={secureStoreServerUrl(store)}
      fetchOverride={fetchImpl}
    >
      {children}
    </AppBootstrapped>,
  );
}

async function submitLogin(username: string, password: string) {
  // fireEvent.change sets the whole value at once; per-keystroke userEvent.type
  // loses characters to react-native-web's controlled TextInput re-renders.
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('App shell (auth bootstrap)', () => {
  let fetchMock: typeof fetch;
  let logged: LoggedRequest[];

  beforeEach(() => {
    logged = [];
    fetchMock = makeFetch(logged);
  });

  it('shows the login screen when no session token is stored', async () => {
    const store = fakeStore();
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('signed-in-tree')).toBeNull();
  });

  it('restores a stored session and renders the signed-in tree', async () => {
    const store = fakeStore({ 'vjt.token': 'session-1' });
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByText('signed-in-tree')).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logged[0]).toMatchObject({ method: 'GET', authorization: 'Bearer session-1' });
  });

  it('signs in and persists the session token to secure storage', async () => {
    const store = fakeStore();
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
    });
    await submitLogin('learner', 'hunter2');

    await waitFor(() => {
      expect(screen.getByText('signed-in-tree')).toBeTruthy();
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

  it('reports an unreachable server and Retry recovers', async () => {
    const store = fakeStore({ 'vjt.token': 'session-1' });
    // fetchOverride is captured when AuthProvider mounts, so Retry must swap the
    // implementation behind a stable wrapper rather than re-render with a new one.
    let impl: typeof fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => impl(input, init)) as unknown as typeof fetch;
    renderApp(store, fetchMock);

    await waitFor(() => {
      expect(screen.getByText(/Cannot reach the server/)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText(/Server address: http:\/\/10\.0\.2\.2:8080/)).toBeTruthy();

    // Retry re-checks the same stored session.
    impl = makeFetch(logged);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByText('signed-in-tree')).toBeTruthy();
    });
  });

  it('Android saves a new server address, forgets the old token, and talks to the new host only after a fresh sign-in', async () => {
    // The server-address field is Android-only (web infers it from the origin).
    const os = Platform.OS;
    (Platform as { OS: typeof os }).OS = 'android';
    try {
      const store = fakeStore({ 'vjt.token': 'stale-session' });
      renderApp(store, fetchMock);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Change server' })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Change server' }));
      fireEvent.change(screen.getByLabelText('Server address'), {
        target: { value: 'http://192.168.1.50:8080/' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

      // The address is remembered and any token from the old host is gone…
      await waitFor(() => {
        expect(store.dump()['vjt.serverUrl']).toBe('http://192.168.1.50:8080');
      });
      expect(store.dump()['vjt.token']).toBeUndefined();
      // …and nothing — least of all an old bearer token — reached the new host.
      expect(logged.filter((r) => r.url.startsWith('http://192.168.1.50:8080'))).toEqual([]);

      // Signing in on the rebuilt tree resumes against the new base URL.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
      });
      await submitLogin('learner', 'hunter2');
      await waitFor(() => {
        expect(screen.getByText('signed-in-tree')).toBeTruthy();
      });
      expect(logged.some((r) => r.url === 'http://192.168.1.50:8080/auth/login')).toBe(true);
    } finally {
      (Platform as { OS: typeof os }).OS = os;
    }
  });

  it('shows an error when saving a new server address fails', async () => {
    const os = Platform.OS;
    (Platform as { OS: typeof os }).OS = 'android';
    try {
      const store = fakeStore();
      const failingUrlStorage = {
        get: async () => null,
        set: async () => {
          throw new Error('Could not remember the address');
        },
      };
      render(
        <AppBootstrapped
          tokenStorage={secureStoreTokenStorage(store)}
          urlStorage={failingUrlStorage}
          fetchOverride={fetchMock}
        >
          {PROBE}
        </AppBootstrapped>,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Change server' })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Change server' }));
      fireEvent.change(screen.getByLabelText('Server address'), {
        target: { value: 'http://192.168.1.50:8080' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

      await waitFor(() => {
        expect(screen.getByText('Could not remember the address')).toBeTruthy();
      });
      // Still editing, so the Learner can fix the address.
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    } finally {
      (Platform as { OS: typeof os }).OS = os;
    }
  });

  it('the default export wires the real secure-store adapters', async () => {
    // The test-harness expo-secure-store stub holds no token, so the production
    // App (no props injected) must hydrate and land on the login form.
    render(<App>{null}</App>);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
    });
  });
});
