/* Button — spec §4.3/§4.7. Props: variant 'primary' (paper fill) | 'secondary'
 * (outline) | 'destructive'; lab=true for 64px Lab targets; block for full width.
 * All other props spread onto the native <button>. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive';
  lab?: boolean;
  block?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'primary', lab = false, block = false, className = '', children, type = 'button', ...rest }: ButtonProps) {
  const cls = ['z-btn', `z-btn--${variant}`, lab ? 'z-btn--lab' : '', block ? 'z-btn--block' : '', className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest}>{children}</button>;
}
