/* 2.0 "Ask the coach about this" (docs/v2/research/design.md §B.1): opens
 * Coach › Ask with the question started from what is on screen. */
import { Link } from 'react-router-dom';
import { IconCoach } from '../icons';
import './AskCoachLink.css';

export function AskCoachLink({ about, label = 'Ask the coach about this' }: { about: string; label?: string }) {
  return (
    <Link className="z-ask-coach" to={`/coach/ask?about=${encodeURIComponent(about)}`}>
      <IconCoach size={18} />
      <span>{label}</span>
    </Link>
  );
}
