/* ResearchNoteView — release 1.3.0. One web-sourced note: the 'web' badge
 * with model and date, the checked Markdown, a notice when the text carries
 * frame numbers (they came from the web, not the Codex), the citations, and
 * whatever actions the screen passes (Keep, Refresh, Delete). Shared by the
 * Coach "Look it up" tab, the Character screen and Patch Watch. */
import type { ReactNode } from 'react';
import { citationHost, isRenderableCitation } from '../../domain/intel/research';
import type { ResearchNote } from '../../data/schemas';
import { renderSafeMarkdown } from '../coach/markdown';
import { DataBadge } from '../base/DataBadge';
import './ResearchNoteView.css';

export interface ResearchNoteViewProps {
  note: ResearchNote;
  /** Frame-like numbers found in the text (from checkResearch). */
  frameTokens?: string[];
  /** Extra line under the badge: "cached by the site", "kept on this device". */
  meta?: string;
  actions?: ReactNode;
  /** Render the question as the heading (answers); primers and briefs have their own card titles. */
  showQuestion?: boolean;
}

function shortModel(model: string): string {
  return model.replace(/^[^/]+\//, '');
}

export function ResearchNoteView({ note, frameTokens = [], meta, actions, showQuestion = false }: ResearchNoteViewProps) {
  const citations = note.citations.filter(isRenderableCitation);
  return (
    <article className="z-research" data-testid="research-note">
      {showQuestion && <p className="z-research__question">{note.question}</p>}
      <div className="z-research__badges">
        <DataBadge status="web" detail={`${shortModel(note.model)} · ${note.createdAt.slice(0, 10)}`} />
        {meta !== undefined && <span className="z-research__meta">{meta}</span>}
      </div>
      <div className="z-research__body">{renderSafeMarkdown(note.text)}</div>
      {frameTokens.length > 0 && (
        <p className="z-research__frames">
          Frame numbers here ({frameTokens.slice(0, 6).join(', ')}{frameTokens.length > 6 ? ', …' : ''}) came from the web, not
          your Codex. Verify them there before you trust them.
        </p>
      )}
      {citations.length > 0 && (
        <ol className="z-research__citations" aria-label="Sources">
          {citations.map((citation) => (
            <li key={citation.id}>
              <span className="z-research__cite-id">[{citation.id}]</span>{' '}
              <a href={citation.url} target="_blank" rel="noopener noreferrer">{citation.title}</a>
              <span className="z-research__meta"> · {citationHost(citation)}{citation.date ? ` · ${citation.date.slice(0, 10)}` : ''}</span>
            </li>
          ))}
        </ol>
      )}
      {actions !== undefined && <div className="z-research__actions">{actions}</div>}
    </article>
  );
}
