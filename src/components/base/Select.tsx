/* Select — spec §4.3/§4.4. Props: id, label, hint?, error?, options
 * [{value,label}], value, onChange, disabled. Label is always visible. */
import type { SelectHTMLAttributes } from 'react';
import './Field.css';

export interface SelectOption { value: string; label: string; }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  id: string; label: string; hint?: string; error?: string;
  options: SelectOption[]; value: string; onChange: (value: string) => void;
}

export function Select({ id, label, hint, error, options, value, onChange, disabled, ...rest }: SelectProps) {
  const hintId = hint ? `${id}-hint` : undefined; const errId = error ? `${id}-error` : undefined;
  return (
    <div className="z-field">
      <label className="z-field__label" htmlFor={id}>{label}</label>
      <select id={id} className="z-field__control" value={value} disabled={disabled}
        aria-invalid={Boolean(error)} aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
        onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="z-field__hint" id={hintId}>{hint}</p>}
      {error && <p className="z-field__error" id={errId} role="alert">{error}</p>}
    </div>
  );
}
