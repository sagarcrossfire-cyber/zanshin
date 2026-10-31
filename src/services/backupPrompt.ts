// Backup prompt — spec §14.3. Every 14 days Today gently prompts an
// export, because browsers can clear site storage. The prompt is due when
// neither a prompt nor an export has been recorded in the last 14 days;
// either action (exporting, or dismissing with "Not now") records the
// date, so it stays quiet for another 14 days.
export const BACKUP_PROMPT_KEY = 'backup:lastPrompt';
export const BACKUP_EXPORT_KEY = 'backup:lastExport';
export const BACKUP_PROMPT_INTERVAL_DAYS = 14;

export function isBackupPromptDue(
  lastPrompt: string | null,
  lastExport: string | null,
  todayIsoDate: string,
): boolean {
  const latest = [lastPrompt, lastExport].filter((v): v is string => v !== null).sort().at(-1);
  if (latest === undefined) return true;
  const latestMs = Date.parse(`${latest}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIsoDate}T00:00:00Z`);
  if (Number.isNaN(latestMs) || Number.isNaN(todayMs)) return true;
  return todayMs - latestMs >= BACKUP_PROMPT_INTERVAL_DAYS * 24 * 3600_000;
}
