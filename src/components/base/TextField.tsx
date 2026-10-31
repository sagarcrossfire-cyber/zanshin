/* TextField — spec §4.3/§4.4. Props: id, label, hint?, error?, multiline?,
 * value, onChange, type/inputMode, placeholder, disabled. Label always visible. */
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import './Field.css';

type Shared = { id: string; label: string; hint?: string; error?: string; multiline?: boolean; };
export type TextFieldProps = Shared & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange'> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'onChange'> & {
  value: string; onChange: (value: string) => void;
};

export function TextField({ id, label, hint, error, multiline = false, value, onChange, ...rest }: TextFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined; const errId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="z-field">
      <label className="z-field__label" htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea id={id} className="z-field__control" value={value} aria-invalid={Boolean(error)} aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input id={id} className="z-field__control" value={value} aria-invalid={Boolean(error)} aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {hint && <p className="z-field__hint" id={hintId}>{hint}</p>}
      {error && <p className="z-field__error" id={errId} role="alert">{error}</p>}
    </div>
  );
}
