/* DataBadge — spec §4.7. Props: status 'verified'|'sourced'|'conflicting'|
 * 'unverified'|'web', detail? (source/revision text), onClick? (Conflicting:
 * tap to compare). Always icon + text label; never color-only. 'web'
 * (release 1.3.0) marks prose the site's intel function fetched from the
 * web: cited, never verified, never frame data. */
import type { ReactNode } from 'react';
import { IconVerified, IconSourced, IconConflicting, IconUnverified, IconWeb } from '../icons';
import './DataBadge.css';

export type DataStatus = 'verified' | 'sourced' | 'conflicting' | 'unverified' | 'web';
const LABELS: Record<DataStatus, string> = { verified: 'Verified', sourced: 'Sourced', conflicting: 'Conflicting', unverified: 'Unverified', web: 'Web-sourced' };
const ICONS: Record<DataStatus, ReactNode> = { verified: <IconVerified />, sourced: <IconSourced />, conflicting: <IconConflicting />, unverified: <IconUnverified />, web: <IconWeb /> };

export interface DataBadgeProps {
  status: DataStatus; detail?: string; onClick?: () => void;
  /** Release 1.4.0: label only, the detail moves to a tooltip (dense lists). */
  compact?: boolean;
}

export function DataBadge({ status, detail, onClick, compact = false }: DataBadgeProps) {
  const label = detail && !compact ? `${LABELS[status]} · ${detail}` : LABELS[status];
  const title = compact && detail ? `${LABELS[status]} · ${detail}` : undefined;
  const cls = `z-data-badge z-data-badge--${status}${compact ? ' z-data-badge--compact' : ''}`;
  if (onClick) return <button type="button" className={cls} title={title} onClick={onClick}>{ICONS[status]}<span>{label}</span></button>;
  return <span className={cls} title={title}>{ICONS[status]}<span>{label}</span></span>;
}
