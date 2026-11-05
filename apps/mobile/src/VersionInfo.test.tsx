import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { VersionInfo } from './VersionInfo.tsx';

// The vitest stub for expo-constants has no app config, so give the app a version.
vi.mock('expo-constants', () => {
  const constants = { expoConfig: { version: '1.2.0' } };
  return { default: constants, ...constants };
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('VersionInfo', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the app and server versions, fetched from /health', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: 'ok', version: '1.2.5' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<VersionInfo serverUrl="http://server.test" />);
    expect(screen.getByText(/Server version: checking/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Server version: 1.2.5')).toBeTruthy());
    expect(screen.getByText('App version: 1.2.0')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('http://server.test/health');
  });

  it('warns when the releases differ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ version: '1.3.0' })));
    render(<VersionInfo serverUrl="http://server.test" />);
    await waitFor(() => expect(screen.getByText('Server version: 1.3.0')).toBeTruthy());
    expect(screen.getByText(/1\.2\.0.*1\.3\.0.*may not work together/)).toBeTruthy();
  });

  it('does not warn when the versions are on the same release line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ version: '1.2.9' })));
    render(<VersionInfo serverUrl="http://server.test" />);
    await waitFor(() => expect(screen.getByText('Server version: 1.2.9')).toBeTruthy());
    expect(screen.queryByText(/may not work together/)).toBeNull();
  });

  it('says unavailable when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    render(<VersionInfo serverUrl="http://server.test" />);
    await waitFor(() => expect(screen.getByText('Server version: unavailable')).toBeTruthy());
    expect(screen.queryByText(/may not work together/)).toBeNull();
  });

  it('says unavailable when the body has no version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'ok', database: 'connected' })));
    render(<VersionInfo serverUrl="http://server.test" />);
    await waitFor(() => expect(screen.getByText('Server version: unavailable')).toBeTruthy());
    expect(screen.queryByText(/may not work together/)).toBeNull();
  });
});
