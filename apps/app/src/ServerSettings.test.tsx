import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ServerSettings } from './ServerSettings.tsx';

describe('mobile ServerSettings', () => {
  it('shows the current URL and saves a normalized override', async () => {
    const saved: string[] = [];
    const onSave = vi.fn(async (url: string) => {
      saved.push(url);
    });
    render(<ServerSettings currentUrl="http://10.0.2.2:8080" onSave={onSave} onBack={() => {}} />);

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
    render(<ServerSettings currentUrl="http://10.0.2.2:8080" onSave={onSave} onBack={() => {}} />);

    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(screen.getByText('Enter the full address, like http://192.168.1.10:8080')).toBeTruthy();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers the emulator default back', async () => {
    const onSave = vi.fn(async () => {});
    render(<ServerSettings currentUrl="http://192.168.1.50:8080" onSave={onSave} onBack={() => {}} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Use the emulator default (http://10.0.2.2:8080)' }),
    );
    expect((screen.getByLabelText('Server address') as HTMLInputElement).value).toBe(
      'http://10.0.2.2:8080',
    );
  });
});
