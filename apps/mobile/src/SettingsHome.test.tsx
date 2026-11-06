import { describe, expect, it } from 'vitest';
import { InterfaceLanguageProvider } from '@vjt/core';
import { fireEvent, render, screen } from '@testing-library/react';

import { SettingsHome, type SettingsSection } from './SettingsHome.tsx';
import { unrubyfiedKanji } from './test/kanjiCoverage.ts';

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

    // The plan's (A4.7) eight sections, in hub order. The grammar review
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
    // The server address is not hub text: it lives in the Server section.
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

  it('in Japanese (furigana) every chrome kanji stands in a reading column', () => {
    // The hub is pure chrome: every row label, the account card and the
    // Log out button come from the string table.
    render(
      <InterfaceLanguageProvider language="ja-furigana" setLanguage={() => undefined}>
        <SettingsHome username="learner" onLogout={() => {}} onOpenSection={() => {}} />
      </InterfaceLanguageProvider>,
    );
    expect(document.querySelectorAll("[style*='font-size']").length).toBeGreaterThan(0);
    expect(unrubyfiedKanji(document.body)).toEqual([]);
  });
});
