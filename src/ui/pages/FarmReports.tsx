import { useState } from 'react';
import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
import { dayShort } from '../../core/settings.ts';
import { LinkedText } from '../components.tsx';

export default function FarmReports() {
  const { league } = useStore();
  const [idx, setIdx] = useState<number | null>(null);
  if (!league) return null;
  const reports = [...(league.farmReports ?? [])].reverse();
  const r = reports[idx ?? 0];
  return (
    <>
      <h1>Farm Reports</h1>
      <p className="muted small">Your farm director files a report every week of the season: players of the week, how the top prospects did, who's struggling, and who he thinks is ready to move up. Prospect rankings are his opinion, so a better evaluator gives better reports. <a href={href('farm')}>Farm System</a></p>
      {!r ? (
        <p className="muted">No reports yet. They start after the first week of the season (and need a farm director on staff).</p>
      ) : (
        <>
          <div className="form-row">
            Report:{' '}
            <select value={idx ?? 0} onChange={(e) => setIdx(Number(e.target.value))}>
              {reports.map((x, i) => <option key={i} value={i}>{dayShort(x.season, x.day)}, {x.season}</option>)}
            </select>{' '}
            <span className="muted small">from {r.by}</span>
          </div>
          {r.sections.map((sec) => (
            <div key={sec.title}>
              <h2>{sec.title}</h2>
              {sec.lines.map((l, i) => (
                <div key={i} className="news-item">
                  <LinkedText league={league} text={l.text} pids={l.pids} />
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </>
  );
}
