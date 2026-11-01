// 2.0 M1 — the Settings switch for error reports: on by default (an absent
// setting means on), saved with the other settings, and the settings schema
// accepts rows written before the field existed.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/data/bootstrap';
import { resetDbForTests, settingsRepo } from '../../../src/data/repos';
import { settingsSchema } from '../../../src/data/schemas';
import { SettingsScreen } from '../../../src/screens/settings/SettingsScreen';
import { useAppStore } from '../../../src/stores/appStore';

const LABEL = 'Send error reports to my site so problems can be fixed';

beforeEach(async () => {
  await resetDbForTests();
  useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [] });
  window.localStorage.clear();
});

describe('Settings → Data: error reports', () => {
  it('the schema takes the field as optional', () => {
    expect(settingsSchema.safeParse(defaultSettings()).success).toBe(true);
    expect(settingsSchema.safeParse({ ...defaultSettings(), telemetry: false }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...defaultSettings(), telemetry: 'yes' }).success).toBe(false);
  });

  it('is on by default and saving it off stores telemetry: false', async () => {
    await useAppStore.getState().load();
    render(<MemoryRouter><SettingsScreen /></MemoryRouter>);
    const toggle = await screen.findByLabelText(LABEL);
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(async () => {
      expect((await settingsRepo.get())?.telemetry).toBe(false);
    });
    expect(useAppStore.getState().settings?.telemetry).toBe(false);
  });
});
