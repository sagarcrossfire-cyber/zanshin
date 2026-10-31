/* IconButton — spec §4.12. Props: ariaLabel (required — icon carries no meaning
 * alone), lab for 64px targets, outline variant. Icon child must be aria-hidden. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './IconButton.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ariaLabel: string;
  lab?: boolean;
  outline?: boolean;
  children: ReactNode;
}

export function IconButton({ ariaLabel, lab = false, outline = false, className = '', children, type = 'button', ...rest }: IconButtonProps) {
  const cls = ['z-icon-btn', lab ? 'z-icon-btn--lab' : '', outline ? 'z-icon-btn--outline' : '', className].filter(Boolean).join(' ');
  return <button type={type} className={cls} aria-label={ariaLabel} {...rest}>{children}</button>;
}
