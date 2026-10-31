// Mastery-over-time chart — lazy-loaded (§13.8) so Recharts ships only
// when a node detail with practice history renders. Only the latest
// evidence day carries a score (D-025); history accumulates from this
// build onward.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface MasteryPoint {
  day: string;
  score: number | null;
}

export default function NodeMasteryChart({ points }: { points: MasteryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={points}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="day" />
        <YAxis domain={[0, 100]} />
        <Tooltip />
        <Line type="monotone" dataKey="score" stroke="var(--mastery)" dot connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
