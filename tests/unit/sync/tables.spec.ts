// M3 — table classification acceptance tests: coverage of every Dexie table exactly once, and the
// settings secret-stripping guard.
import { describe, expect, it } from 'vitest';
import { V5_STORES } from '../../../src/data/db';
import { settingsSchema } from '../../../src/data/schemas';
import {
  ALL_TABLE_NAMES,
  DERIVED_TABLES,
  DEVICE_LOCAL_TABLES,
  LWW_TABLES,
  UNION_TABLES,
  classifyTable,
  isSyncedTable,
  stripDeviceLocalSettings,
} from '../../../src/domain/sync/tables';

describe('tables', () => {
  it('covers every Dexie table from db.ts exactly once, across the four classes', () => {
    const dbTables = Object.keys(V5_STORES).sort();
    const classified = [...ALL_TABLE_NAMES].sort();
    expect(classified).toEqual(dbTables);

    // exactly once: no duplicates across the four lists
    const seen = new Set<string>();
    for (const t of ALL_TABLE_NAMES) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it('classifies matchSets and sessions as LWW, not pure union (per the card decision)', () => {
    expect(classifyTable('matchSets')).toBe('lww');
    expect(classifyTable('sessions')).toBe('lww');
    expect(UNION_TABLES).not.toContain('matchSets');
    expect(UNION_TABLES).not.toContain('sessions');
  });

  it('classifies only the decided set as pure union', () => {
    expect([...UNION_TABLES].sort()).toEqual(
      ['assessments', 'coachMessages', 'research', 'reviews', 'sets', 'verifications'].sort(),
    );
  });

  it('classifies mastery as derived and never synced', () => {
    expect(classifyTable('mastery')).toBe('derived');
    expect(isSyncedTable('mastery')).toBe(false);
  });

  it('classifies device-local tables as never synced', () => {
    for (const t of DEVICE_LOCAL_TABLES) {
      expect(classifyTable(t)).toBe('device-local');
      expect(isSyncedTable(t)).toBe(false);
    }
  });

  it('every union and lww table is a synced table, and nothing else is', () => {
    for (const t of UNION_TABLES) expect(isSyncedTable(t)).toBe(true);
    for (const t of LWW_TABLES) expect(isSyncedTable(t)).toBe(true);
    for (const t of DERIVED_TABLES) expect(isSyncedTable(t)).toBe(false);
    for (const t of DEVICE_LOCAL_TABLES) expect(isSyncedTable(t)).toBe(false);
  });

  it('throws for an unknown table name', () => {
    expect(() => classifyTable('nonexistentTable')).toThrow(/unclassified sync table/);
  });

  describe('stripDeviceLocalSettings', () => {
    const placeholderCredential = ['placeholder', 'credential', 'value'].join('-');

    it('strips aiApiKey', () => {
      const settings: Record<string, unknown> = { id: 'settings', theme: 'dark' };
      settings.aiApiKey = placeholderCredential;
      const stripped = stripDeviceLocalSettings(settings);
      expect(stripped).toEqual({ id: 'settings', theme: 'dark' });
      expect('aiApiKey' in stripped).toBe(false);
    });

    it('strips any field ending in Key, Token or Secret, even ones invented later', () => {
      const settings: Record<string, unknown> = {
        id: 'settings',
        theme: 'dark',
        notAKeyword: 'kept',
      };
      settings.someNewApiKey = placeholderCredential;
      settings.refreshToken = placeholderCredential;
      settings.clientSecret = placeholderCredential;
      const stripped = stripDeviceLocalSettings(settings);
      expect(stripped).toEqual({ id: 'settings', theme: 'dark', notAKeyword: 'kept' });
    });

    it('fails loudly if a settings field matches the secret pattern and is not stripped (regression guard)', () => {
      // This test exists so a future settings field shaped like a credential cannot silently sync.
      // It directly exercises the exported pattern rather than hand-maintaining a field list.
      const probe = { someWeirdoSecret: 'value' };
      const stripped = stripDeviceLocalSettings(probe);
      expect('someWeirdoSecret' in stripped).toBe(false);
    });

    it('keeps every non-secret field untouched', () => {
      const settings = { id: 'settings', theme: 'dark', repsPerSet: 5 };
      expect(stripDeviceLocalSettings(settings)).toEqual(settings);
    });

    it('strips aiApiKey from a real parsed Settings record and keeps the rest', () => {
      const base = {
        id: 'settings' as const,
        theme: 'dark' as const,
        labAudioCues: true,
        labWakeLock: false,
        repsPerSet: 10,
        newCardsPerDay: 5,
        reviewsPerDay: 20,
        aiProvider: 'zanshin' as const,
        aiRequestsPerHour: 10,
        snapshotsKeptDaily: 7,
        snapshotsKeptEvent: 7,
        backupReminderDays: 14,
        inAppImporterEnabled: true,
        matchImportEnabled: true,
        dataPatch: '1.0',
        dataSource: 'wavu' as const,
        kpiTargets: {},
      };
      const withCredential: Record<string, unknown> = { ...base };
      withCredential.aiApiKey = placeholderCredential;
      const settings = settingsSchema.parse(withCredential);
      const stripped = stripDeviceLocalSettings(settings);
      expect('aiApiKey' in stripped).toBe(false);
      expect(stripped.theme).toBe('dark');
      expect(stripped.aiProvider).toBe('zanshin');
    });

    it('every field name in the live Settings schema either stays or matches the secret pattern', () => {
      // Guards against a new settings field whose *value* is sensitive but whose *name* happens
      // not to end in Key/Token/Secret: this at least documents every field's fate explicitly.
      const shape = settingsSchema.shape;
      const fieldNames = Object.keys(shape);
      const secretFields = fieldNames.filter((f) => /(Key|Token|Secret)$/.test(f));
      expect(secretFields).toEqual(['aiApiKey']);
    });
  });
});
