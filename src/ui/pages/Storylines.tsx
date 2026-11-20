// Storylines around the league (or just your organization).
import { useState } from 'react';
import { useStore } from '../../store.ts';
import { dayShort } from '../../core/settings.ts';
import { LinkedText } from '../components.tsx';

export default function Storylines() {
  const { league } = useStore();
  const [mine, setMine] = useState(false);
  if (!league) return null;
  const all = [...(league.stories ?? [])].reverse().filter((s) => !mine || s.orgId === league.userOrgId);
  return (
    <>
      <h1>Storylines</h1>
      <p className="muted small">Breakouts, new pitches, slumps, freak injuries, suspensions, clubhouse drama and more. Frequency and career-ending stories are set in League Settings ({league.settings.storylines ?? 'normal'}{league.settings.careerEndingStories === false ? ', no career-ending stories' : ''}).</p>
      <div className="btn-group tabs">
        <button className={`btn btn-sm${!mine ? ' active' : ''}`} onClick={() => setMine(false)}>League</button>
        <button className={`btn btn-sm${mine ? ' active' : ''}`} onClick={() => setMine(true)}>My organization</button>
      </div>
      {!all.length && <p className="muted">No storylines yet.</p>}
      {all.map((s) => (
        <div key={s.id} className="news-item">
          <span className="muted small">{dayShort(s.season, s.day)}</span> <b>{s.title}</b> · <LinkedText league={league} text={s.text} pids={s.pids} />
        </div>
      ))}
    </>
  );
}
