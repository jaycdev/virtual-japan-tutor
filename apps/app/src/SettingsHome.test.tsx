import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { fakeBackHandler } from '../test/back-handler-fake.ts';
import { setBackHandlerForTests } from './hardwareBack.ts';
import { SettingsHome } from './SettingsHome.tsx';

function renderHome() {
  const noop = () => {};
  return render(
    <SettingsHome
      client={undefined as never}
      username="learner"
      onLogout={noop}
      serverUrl="http://10.0.2.2:8080"
      onSaveServerUrl={async () => {}}
    />,
  );
}

describe('mobile SettingsHome', () => {
  afterEach(() => setBackHandlerForTests(undefined));

  it('opens every settings section from the home rows', () => {
    renderHome();

    for (const label of [
      'MaruMori',
      'AI Providers',
      'Starting Level',
      'Stories',
      'Reading',
      'Item Lists',
      'Server',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByText('learner')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'AI Providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Item Lists' })).toBeTruthy();
  });

  it('pops a section back to the hub on hardware Back, and stands down on the hub', () => {
    const back = fakeBackHandler();
    setBackHandlerForTests(back);
    renderHome();

    // On the hub no listener is attached, so Android's default (leave the app) stands.
    expect(back.press()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'AI Providers' }));
    expect(back.press()).toBe(true);
    expect(screen.getByRole('button', { name: 'Item Lists' })).toBeTruthy();
  });
});
