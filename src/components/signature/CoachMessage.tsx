/* CoachMessage — spec §4.7. Props: message (plain text), citations
 * [{id,label}], onCite(id) — citation chips are buttons that link into the
 * Codex via the parent's handler. Candid coach voice is the caller's content;
 * this component only renders it with its citations. */
import { Card } from '../base/Card';
import { Chip } from '../base/Chip';
import { IconSourced } from '../icons';
import './Supporting.css';

export interface Citation { id: string; label: string; }
export interface CoachMessageProps { message: string; citations?: Citation[]; onCite?: (id: string) => void; title?: string; }

export function CoachMessage({ message, citations = [], onCite, title = 'Coach' }: CoachMessageProps) {
  return (
    <Card title={title}>
      <div className="z-coach">
        <p className="z-body">{message}</p>
        {citations.length > 0 && (
          <div className="z-coach__cites" aria-label="Sources">
            {citations.map((c) => (
              <Chip key={c.id} tone="default" icon={<IconSourced size={14} />} onClick={onCite ? () => onCite(c.id) : undefined}>{c.label}</Chip>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
