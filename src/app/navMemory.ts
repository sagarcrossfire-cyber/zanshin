// 2.0 navigation memory (design.md §B.1): each hub reopens on the screen
// Sagar last used in it (per tab session), and the desktop rail remembers
// whether it is collapsed (per device). Conveniences only: every storage
// call is wrapped, and the app works with storage unavailable.
import { hubFor, type HubId } from './hubs';

const LAST_KEY = 'zanshin:hub-last';
const RAIL_KEY = 'zanshin:rail-collapsed';

function readLast(): Partial<Record<HubId, string>> {
  try {
    const raw = window.sessionStorage.getItem(LAST_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Partial<Record<HubId, string>>) : {};
  } catch {
    return {};
  }
}

/** Remember the route (path + query) as the last one used in its hub. */
export function rememberRoute(pathname: string, search = ''): void {
  const hub = hubFor(pathname);
  if (hub === null) return;
  try {
    const last = readLast();
    last[hub.id] = `${pathname}${search}`;
    window.sessionStorage.setItem(LAST_KEY, JSON.stringify(last));
  } catch {
    // Storage unavailable: hubs open at their root.
  }
}

/** Where a hub's dock or rail entry should go. */
export function hubTarget(id: HubId, root: string): string {
  const last = readLast()[id];
  return typeof last === 'string' && last.startsWith('/') && hubFor(last.split('?')[0] ?? '')?.id === id ? last : root;
}

export function readRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeRailCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0');
  } catch {
    // Not remembered; fine.
  }
}
