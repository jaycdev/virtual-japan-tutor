import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// The theme store is a module singleton and the uniwind stub records theme
// switches for the whole process, so every test starts from a freshly
// imported module graph (see src/theme/index.test.tsx for the same pattern).
// The providers come from the same fresh graph: they hydrate the very store
// singletons the component under test subscribes to.
async function freshAppearanceSettings() {
  vi.resetModules();
  const stub = await import('../test/uniwind-stub');
  const { AppearanceSettings } = await import('./AppearanceSettings.tsx');
  const { ThemeProvider } = await import('./theme/index.tsx');
  const { StoryTextSizeProvider } = await import('./storysize/index.tsx');
  stub.setThemeCalls.length = 0;
  return { AppearanceSettings, ThemeProvider, StoryTextSizeProvider, setThemeCalls: stub.setThemeCalls };
}

describe('mobile AppearanceSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('switches the app theme immediately and remembers the choice', async () => {
    const { AppearanceSettings, setThemeCalls } = await freshAppearanceSettings();
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(setThemeCalls).toContain('dark');
    expect(localStorage.getItem('vjt.theme')).toBe('dark');
    expect(
      (screen.getByRole('button', { name: 'Dark' }) as HTMLElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'System' }));

    expect(setThemeCalls).toContain('system');
    expect(localStorage.getItem('vjt.theme')).toBe('system');
  });

  it('applies a story text size immediately and remembers it', async () => {
    const { AppearanceSettings } = await freshAppearanceSettings();
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'L' }));

    expect(localStorage.getItem('vjt.storyTextSize')).toBe('L');
    expect(
      (screen.getByRole('button', { name: 'M' }) as HTMLElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false');
  });

  it('starts from the persisted choices', async () => {
    localStorage.setItem('vjt.theme', 'light');
    localStorage.setItem('vjt.storyTextSize', 'XL');

    const { AppearanceSettings, ThemeProvider, StoryTextSizeProvider } =
      await freshAppearanceSettings();
    // The providers are what hydrate the two per-device stores; without them
    // nothing would ever read the persisted values back.
    render(
      <ThemeProvider>
        <StoryTextSizeProvider>
          <AppearanceSettings />
        </StoryTextSizeProvider>
      </ThemeProvider>,
    );

    // Both per-device stores hydrate asynchronously; the chips light up as
    // the stored values land.
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Light' }) as HTMLElement).getAttribute(
          'aria-pressed',
        ),
      ).toBe('true'),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'XL' }) as HTMLElement).getAttribute(
          'aria-pressed',
        ),
      ).toBe('true'),
    );
  });
});
