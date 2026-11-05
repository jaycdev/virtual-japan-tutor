import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const constants = vi.hoisted(() => ({ expoConfig: { version: '1.2.0' } as { version: string } | null }));

vi.mock('expo-constants', () => ({ default: constants }));

import { VersionLines } from './VersionLines.tsx';

describe('mobile VersionLines', () => {
  beforeEach(() => {
    constants.expoConfig = { version: '1.2.0' };
  });

  it('shows both versions and an alert when the server is a different release', () => {
    render(<VersionLines serverVersion="1.3.0" />);

    expect(screen.getByText('App version: 1.2.0')).toBeTruthy();
    expect(screen.getByText('Server version: 1.3.0')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows no alert when major.minor match', () => {
    render(<VersionLines serverVersion="1.2.9" />);

    expect(screen.getByText('Server version: 1.2.9')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows "unknown" and no alert when the server version is missing', () => {
    render(<VersionLines serverVersion={undefined} />);

    expect(screen.getByText('Server version: unknown')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows no alert for a dev app build', () => {
    constants.expoConfig = { version: 'dev.142+1cfdacb' };
    render(<VersionLines serverVersion="1.3.0" />);

    expect(screen.getByText('App version: dev.142+1cfdacb')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
