/* DataBadge — spec §4.7. Props: status 'verified'|'sourced'|'conflicting'|
 * 'unverified', detail? (source/revision text), onClick? (Conflicting: tap to
 * compare). Always icon + text label; never color-only. */
import type { ReactNode } from 'react';
import { IconVerified, IconSourced, IconConflicting, IconUnverified } from '../icons';
import './DataBadge.css';

export type DataStatus = 'verified' | 'sourced' | 'conflicting' | 'unverified';
const LABELS: Record<DataStatus, string> = { verified: 'Verified', sourced: 'Sourced', conflicting: 'Conflicting', unverified: 'Unverified' };
const ICONS: Record<DataStatus, ReactNode> = { verified: <IconVerified />, sourced: <IconSourced />, conflicting: <IconConflicting />, unverified: <IconUnverified /> };

export interface DataBadgeProps { status: DataStatus; detail?: string; onClick?: () => void; }

export function DataBadge({ status, detail, onClick }: DataBadgeProps) {
  const label = detail ? `${LABELS[status]} · ${detail}` : LABELS[status];
  const cls = `z-data-badge z-data-badge--${status}`;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{ICONS[status]}<span>{label}</span></button>;
  return <span className={cls}>{ICONS[status]}<span>{label}</span></span>;
}
