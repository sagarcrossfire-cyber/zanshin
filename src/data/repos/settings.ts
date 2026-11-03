// §6.3/§5.17 — Settings repository: the single 'settings' row.
import { db } from '../db';
import { settingsSchema, type Settings } from '../schemas';
import { stripDeviceLocalSettings } from '../../domain/sync/tables';
import { withSyncCapture } from './syncCapture';

export const settingsRepo = {
  /** Returns the settings row, or undefined before first launch. */
  async get(): Promise<Settings | undefined> {
    return db.settings.get('settings');
  },
  /** Validates and upserts the settings row. */
  async put(settings: Settings): Promise<Settings> {
    const parsed = settingsSchema.parse(settings);
    await withSyncCapture(
      { table: 'settings', id: parsed.id, op: 'put', value: stripDeviceLocalSettings(parsed) },
      () => db.settings.put(parsed),
    );
    return parsed;
  },
  /** Returns all settings rows (at most one). */
  async all(): Promise<Settings[]> {
    return db.settings.toArray();
  },
  /** Removes the settings row. */
  async remove(): Promise<void> {
    await withSyncCapture(
      { table: 'settings', id: 'settings', op: 'delete' },
      () => db.settings.delete('settings'),
    );
  },
};
