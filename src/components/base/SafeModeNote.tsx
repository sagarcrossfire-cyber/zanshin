// Safe Mode note — spec §14.4. Shared wording for every screen whose
// writes are disabled in Safe Mode (seed packs, read-only, export works).
export function SafeModeNote({ what }: { what: string }) {
  return (
    <p className="z-safe-note" role="status">
      Safe Mode is on: {what} is disabled. Your data is read-only; export still works in Settings.
    </p>
  );
}
