/* Skeleton — loading placeholder. Props: width?, height?, label? (announced as
 * "Loading" via aria-label on a status region; decorative shimmer is hidden). */
import './Skeleton.css';

export interface SkeletonProps { width?: number | string; height?: number | string; label?: string; }

export function Skeleton({ width = '100%', height = 20, label = 'Loading' }: SkeletonProps) {
  return <div className="z-skeleton" role="status" aria-label={label} style={{ width, height }} />;
}
