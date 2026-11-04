import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  SettingsHome,
  SettingsSectionMenu,
  type SettingsSection,
} from './SettingsHome.tsx';

function renderHome() {
  const opened: SettingsSection[] = [];
  render(
    <SettingsHome
      username="learner"
      onLogout={() => {}}
      onOpenSection={(section) => opened.push(section)}
    />,
  );
  return opened;
}

describe('mobile SettingsHome', () => {
  it('opens every settings section from the hub rows', () => {
    const opened = renderHome();

    // The plan's (§4.7) eight sections, in hub order. The grammar review
    // list is not one of them: it lives inside Starting Level, read-only.
    for (const label of [
      'Appearance',
      'Reading',
      'Stories',
      'Item Lists',
      'Starting Level',
      'MaruMori',
      'AI Providers',
      'Server',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByText('learner')).toBeTruthy();
    // The server address is not hub text any more — it lives in the Server
    // section, where the platform split decides whether it is even editable.
    expect(screen.queryByText('http://10.0.2.2:8080')).toBeNull();

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
        onOpenSection={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(loggedOut).toBe(true);
  });

  it('leaves the account card out when the sidebar owns it (wide)', () => {
    render(
      <SettingsHome
        username="learner"
        onLogout={() => {}}
        showAccount={false}
        onOpenSection={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
    expect(screen.queryByText('learner')).toBeNull();
    // The menu itself is still complete.
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeTruthy();
  });
});

describe('mobile SettingsSectionMenu', () => {
  it('marks the open section as the current one', () => {
    render(<SettingsSectionMenu active="marumori" onOpen={() => {}} />);
    // S3: aria-current="page" — the rows are buttons, and aria-selected is
    // not a valid state on a button.
    expect(
      (screen.getByRole('button', { name: 'MaruMori' }) as HTMLElement).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      (screen.getByRole('button', { name: 'Server' }) as HTMLElement).getAttribute('aria-current'),
    ).toBeNull();
  });
});
