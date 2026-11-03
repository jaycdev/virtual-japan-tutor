import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { SettingsHome, type SettingsSection } from './SettingsHome.tsx';

function renderHome() {
  const opened: SettingsSection[] = [];
  render(
    <SettingsHome
      username="learner"
      onLogout={() => {}}
      serverUrl="http://10.0.2.2:8080"
      onOpenSection={(section) => opened.push(section)}
    />,
  );
  return opened;
}

describe('mobile SettingsHome', () => {
  it('opens every settings section from the home rows', () => {
    const opened = renderHome();

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
    expect(screen.getByText('http://10.0.2.2:8080')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'AI Providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Item Lists' }));
    expect(opened).toEqual(['ai', 'lists']);
  });

  it('logs out from the Account card', () => {
    let loggedOut = false;
    render(
      <SettingsHome
        username="learner"
        onLogout={() => {
          loggedOut = true;
        }}
        serverUrl="http://10.0.2.2:8080"
        onOpenSection={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(loggedOut).toBe(true);
  });
});
