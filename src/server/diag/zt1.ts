// 2.0 M1 — the one structured log line every server breadcrumb uses.
// Netlify keeps function logs for 24 h on the Free plan; Claude reads them
// with the observability connector (get-request-logs, log text "ZT1"), see
// docs/REFERENCE.md §6 "Telemetry". One line per event, JSON after the tag,
// so a line can be parsed back without guessing.

export type Zt1Logger = (line: string) => void;

export const ZT1_TAG = 'ZT1 ';

export function zt1Line(event: object): string {
  return ZT1_TAG + JSON.stringify(event);
}

/** console.error, so the line is never filtered out as debug noise. */
export const consoleZt1: Zt1Logger = (line) => {
  console.error(line);
};
