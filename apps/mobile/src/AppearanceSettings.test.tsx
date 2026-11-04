import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Per-device settings persist in the Android secure store; the test host swaps
// it for an in-memory map so the persisted values can be seeded and read back.
const secure = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.delete(key);
  },
}));

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
    secure.clear();
  });

  // First test in the file: its dynamic import is the cold transform of the whole
  // module graph, which takes far longer than 15 s on a shared runner. A timeout
  // here also leaks this test's render into the next one, so give it room.
  it('switches the app theme immediately and remembers the choice', async () => {
    const { AppearanceSettings, setThemeCalls } = await freshAppearanceSettings();
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(setThemeCalls).toContain('dark');
    expect(secure.get('vjt.theme')).toBe('dark');
    expect(
      (screen.getByRole('button', { name: 'Dark' }) as HTMLElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'System' }));

    expect(setThemeCalls).toContain('system');
    expect(secure.get('vjt.theme')).toBe('system');
  }, 60_000);

  it('applies a story text size immediately and remembers it', async () => {
    const { AppearanceSettings } = await freshAppearanceSettings();
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'L' }));

    expect(secure.get('vjt.storyTextSize')).toBe('L');
    expect(
      (screen.getByRole('button', { name: 'M' }) as HTMLElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false');
  });

  it('starts from the persisted choices', async () => {
    secure.set('vjt.theme', 'light');
    secure.set('vjt.storyTextSize', 'XL');

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
