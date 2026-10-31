// Progress charts — lazy-loaded (§13.8) so Recharts ships only when the
// Progress route renders. Monochrome (§4.3): Sagar's series --text-1,
// target dashed --line-strong, at most one highlighted series --mastery.
// Bars start at zero, no dual axes, sample size always shown; a chart
// without enough data is hidden with the reason stated (§5.13).
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '../../components/base/Card';
import type { ChartData, ProgressData } from '../../services/progress';

function ChartBlock({ title, data, children }: { title: string; data: ChartData; children: React.ReactNode }) {
  return (
    <Card title={title}>
      {data.hiddenReason !== null ? (
        <p className="z-body-l">{data.hiddenReason}</p>
      ) : (
        <>
          <p className="z-body-l">{data.finding}</p>
          {children}
        </>
      )}
    </Card>
  );
}

export default function ProgressCharts({ data, weeklyMinutes }: { data: ProgressData; weeklyMinutes: number }) {
  return (
    <>
      <ChartBlock title="Mastery index" data={data.mastery}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data.mastery.points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Line type="monotone" dataKey="value" name="Mastery index" stroke="var(--mastery)" dot />
          </LineChart>
        </ResponsiveContainer>
      </ChartBlock>

      <ChartBlock title="Drill success" data={data.drills}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data.drills.points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
            <Tooltip formatter={(v: number) => [`${Math.round(v * 100)}%`, 'Success']} />
            <Line type="monotone" dataKey="value" name="Success rate" stroke="var(--text-1)" dot />
          </LineChart>
        </ResponsiveContainer>
      </ChartBlock>

      <ChartBlock title="Punish quiz accuracy" data={data.quiz}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data.quiz.points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
            <Tooltip formatter={(v: number) => [`${Math.round(v * 100)}%`, 'Accuracy']} />
            <Line type="monotone" dataKey="value" name="Accuracy" stroke="var(--text-1)" dot />
          </LineChart>
        </ResponsiveContainer>
      </ChartBlock>

      <ChartBlock title="Match KPIs — missed punishes per game" data={data.kpis}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data.kpis.points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis domain={[0, 'auto']} />
            <Tooltip />
            <Line type="monotone" dataKey="value" name="Missed per game" stroke="var(--text-1)" dot />
            <ReferenceLine y={2} stroke="var(--line-strong)" strokeDasharray="4 4" label="Target 2.0" />
          </LineChart>
        </ResponsiveContainer>
        {data.kpis.windows.length > 0 && (
          <p className="z-label">
            Latest window: {data.kpis.windows[data.kpis.windows.length - 1]?.throwBreakRate === null
              ? 'no throws faced'
              : `${Math.round((data.kpis.windows[data.kpis.windows.length - 1]?.throwBreakRate ?? 0) * 100)}% throws broken`}
            {', '}
            {data.kpis.windows[data.kpis.windows.length - 1]?.hitWhileMinusPerGame.toFixed(1)} hit while minus per game
            {data.kpis.windows[data.kpis.windows.length - 1]?.lowsBlockedRate === null
              ? ''
              : `, ${Math.round((data.kpis.windows[data.kpis.windows.length - 1]?.lowsBlockedRate ?? 0) * 100)}% lows blocked`}
            .
          </p>
        )}
      </ChartBlock>

      <ChartBlock title="Win rate by character" data={data.winRate}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.winRate.points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip formatter={(v: number) => [`${Math.round(v)}%`, 'Win rate']} />
            <Bar dataKey="value" name="Win rate" fill="var(--text-1)" />
          </BarChart>
        </ResponsiveContainer>
        {data.winRate.belowMinimum.length > 0 && (
          <p className="z-label">
            Below the 10-game minimum (listed, not charted):{' '}
            {data.winRate.belowMinimum.map((b) => `${b.character} (${b.games})`).join(', ')}.
          </p>
        )}
      </ChartBlock>

      <ChartBlock title="Minutes practiced" data={data.minutes}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.minutes.points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis domain={[0, 'auto']} />
            <Tooltip />
            <Bar dataKey="value" name="Minutes" fill="var(--text-1)" />
            <ReferenceLine y={weeklyMinutes} stroke="var(--line-strong)" strokeDasharray="4 4" label="Weekly budget" />
          </BarChart>
        </ResponsiveContainer>
      </ChartBlock>
    </>
  );
}
