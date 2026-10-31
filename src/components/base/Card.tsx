/* Card — spec §4.5. Props: title (optional header), raised, onClick makes it a
 * <button> card. Children render below the header. */
import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  headerAction?: ReactNode;
  raised?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function Card({ title, headerAction, raised = false, onClick, className = '', children, ...rest }: CardProps) {
  const cls = ['z-card', raised ? 'z-card--raised' : '', onClick ? 'z-card--interactive' : '', className].filter(Boolean).join(' ');
  const inner = (<>
    {(title || headerAction) && (<div className="z-card__header">{title ? <h3 className="z-card__title">{title}</h3> : <span />}{headerAction}</div>)}
    {children}
  </>);
  if (onClick) return <button type="button" className={cls} onClick={onClick} {...(rest as object)}>{inner}</button>;
  return <div className={cls} {...rest}>{inner}</div>;
}
