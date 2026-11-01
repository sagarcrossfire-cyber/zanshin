// Progress — spec §5.13. Honest charts: monochrome (§4.3 — Sagar's series
// --text-1, target dashed --line-strong, at most one highlighted series
// --mastery), bars start at zero, no dual axes, sample size always shown, a
// chart without enough data is hidden with the reason stated. Charts are
// lazy-loaded (§13.8) so Recharts ships only with this route.
import { PageHeader } from '../../components/layout/PageHeader';
import { Suspense, lazy, useEffect, useState } from 'react';
import { Card } from '../../components/base/Card';
import { Skeleton } from '../../components/base/Skeleton';
import { MediaImage } from '../../components/media/MediaImage';
import { rankSubject } from '../../domain/media/subjects';
import { useAppStore } from '../../stores/appStore';
import { isDatabaseClosedError } from '../../data/dbErrors';
import { loadProgressData, type ProgressData } from '../../services/progress';
import { todayIso } from '../../app/planState';
import './Progress.css';

const ProgressCharts = lazy(() => import('./ProgressCharts'));

function ConsistencyGrid({ calendar }: { calendar: ProgressData['calendar'] }) {
  return (
    <div className="z-progress__calendar" role="img" aria-label={`Practiced on ${calendar.practicedDays} of the last ${calendar.totalDays} days`}>
      {calendar.days.map((day) => (
        <span
          key={day.day}
          title={`${day.day}: ${day.practiced ? `${day.minutes} min` : 'no practice'}`}
          className={day.practiced ? 'z-progress__day z-progress__day--practiced' : 'z-progress__day'}
        />
      ))}
    </div>
  );
}

export function ProgressScreen() {
  const profile = useAppStore((s) => s.profile);
  const [data, setData] = useState<ProgressData | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    void loadProgressData(profile, todayIso())
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((error: unknown) => {
        if (!isDatabaseClosedError(error)) throw error;
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  if (!profile) return <main><p>Loading…</p></main>;
  if (!data) return <main><p>Loading…</p></main>;

  return (
    <div className="z-progress">
      <PageHeader eyebrow="The long game" title="Progress" lede="Mastery, minutes and match numbers over time. Consistency counts, not streaks." />
      <Suspense fallback={<Skeleton label="Loading charts…" />}>
        <ProgressCharts data={data} weeklyMinutes={profile.weeklyMinutes} />
      </Suspense>

      <Card title="Rank over time">
        <p className="z-body-l">{data.rankHiddenReason}</p>
        <p className="z-label z-rank-line">
          <span className="z-rank-line__item">
            {profile.currentRank && <MediaImage kind="rank-badge" subjectKey={rankSubject(profile.currentRank)} width={48} />}
            Current rank: {profile.currentRank ?? 'not set'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="z-rank-line__item">
            <MediaImage kind="rank-badge" subjectKey={rankSubject(profile.targetRank)} width={48} />
            Target: {profile.targetRank}
          </span>
        </p>
      </Card>

      <Card title="Consistency">
        <p className="z-body-l">{data.calendar.finding}</p>
        <ConsistencyGrid calendar={data.calendar} />
      </Card>
    </div>
  );
}
