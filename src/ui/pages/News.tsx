import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
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
          {n.orgId !== null && <b>{league.orgs[n.orgId].abbrev}</b>} {n.text}{' '}
          {n.pids.map((id) => (
            <a key={id} href={href('player', [id])} className="small">(player)</a>
          ))}
        </div>
      ))}
    </>
  );
}
