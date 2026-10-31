/* Chip — spec §4.4/§4.5. Props: tone (default|filled|dashed|heat|warning|low|
 * launch), onClick makes it a 44px button, icon optional (aria-hidden). */
import type { HTMLAttributes, ReactNode } from 'react';
import './Chip.css';

export type ChipTone = 'default' | 'filled' | 'dashed' | 'heat' | 'warning' | 'low' | 'launch';
export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  icon?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({ tone = 'default', icon, onClick, className = '', children, ...rest }: ChipProps) {
  const cls = ['z-chip', tone !== 'default' ? `z-chip--${tone}` : '', className].filter(Boolean).join(' ');
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{icon}{children}</button>;
  return <span className={cls} {...rest}>{icon}{children}</span>;
}
