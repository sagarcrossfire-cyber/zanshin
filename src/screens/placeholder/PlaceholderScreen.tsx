// Placeholder screen for routes whose phase has not run yet (§5.1: calm
// EmptyState, no errors). Each placeholder names the screen and its phase.
import { EmptyState } from '../../components/base/EmptyState';
import { Button } from '../../components/base/Button';
import { Link } from 'react-router-dom';

interface PlaceholderScreenProps {
  title: string;
  phase: string;
  body?: string;
  artSrc?: string;
}

export function PlaceholderScreen({ title, phase, body, artSrc }: PlaceholderScreenProps) {
  return (
    <EmptyState
      title={title}
      body={body ?? `This screen arrives in ${phase}. Your data is safe — nothing here is lost.`}
      artSrc={artSrc}
      actions={
        <Link to="/today">
          <Button>Back to Today</Button>
        </Link>
      }
    />
  );
}
