import { useStore } from '../../store.ts';
import { LinkedText } from '../components.tsx';
import { dayShort } from '../../core/settings.ts';

export default function News() {
  const { league } = useStore();
  if (!league) return null;
  const list = [...league.news].reverse();
  return (
    <>
      <h1>News</h1>
      {list.length === 0 && <p className="muted">Nothing yet.</p>}
      {list.map((n) => (
        <div key={n.id} className="news-item">
          <span className="muted small">{dayShort(n.season, n.day)}</span>{' '}
          {n.orgId !== null && <b>{league.orgs[n.orgId].abbrev}</b>} <LinkedText league={league} text={n.text} pids={n.pids} />
        </div>
      ))}
    </>
  );
}
