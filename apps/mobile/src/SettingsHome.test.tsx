import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
});
