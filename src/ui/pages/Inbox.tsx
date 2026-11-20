// Messages from agents, the owner, your staff and other clubs. Some ask for a
// decision; promises you make are checked later.
import { useState } from 'react';
import { useStore, changed, setMessage } from '../../store.ts';
import { href } from '../../router.ts';
import { answerInbox, moraleLabel } from '../../core/morale.ts';
import { dayShort } from '../../core/settings.ts';
import { LinkedText } from '../components.tsx';

export default function Inbox() {
  const { league } = useStore();
  const [filter, setFilter] = useState<'all' | 'action' | 'unread'>('all');
  if (!league) return null;
  const all = [...(league.inbox ?? [])].reverse();
  const shown = all.filter((m) => (filter === 'action' ? m.actions && !m.resolved : filter === 'unread' ? !m.read : true));
  const promises = league.promises ?? [];
  return (
    <>
      <h1>Inbox</h1>
      <div className="btn-group tabs">
        {(['all', 'action', 'unread'] as const).map((f) => (
          <button key={f} className={`btn btn-sm${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'action' ? 'Needs a decision' : 'Unread'}
          </button>
        ))}
      </div>{' '}
      <button className="btn btn-sm" onClick={() => { for (const m of league.inbox ?? []) m.read = true; changed(); }}>Mark all read</button>
      {promises.length > 0 && (
        <p className="small">
          <b>Open promises:</b>{' '}
          {promises.map((pr) => {
            const p = league.players[pr.pid];
            return p ? <span key={pr.pid + pr.kind}><a href={href('player', [p.id])}>{p.first} {p.last}</a> ({pr.kind.replace('-', ' ')}, due {dayShort(league.season, pr.due)}) </span> : null;
          })}
        </p>
      )}
      {!shown.length && <p className="muted">No messages.</p>}
      {shown.map((m) => {
        const p = m.pids.length === 1 ? league.players[m.pids[0]] : undefined;
        return (
          <div key={m.id} className={`box inbox-msg${m.read ? '' : ' unread'}`} onClick={() => { if (!m.read) { m.read = true; changed(); } }}>
            <div className="small muted">{dayShort(m.season, m.day)} · {m.from}</div>
            <div><b>{m.subject}</b>{p?.morale && <span className="small muted"> · {p.first} {p.last} is {moraleLabel(p.morale.value).toLowerCase()} ({Math.round(p.morale.value)})</span>}</div>
            <div className="small"><LinkedText league={league} text={m.text} pids={m.pids} /></div>
            {m.link && <a className="small" href={href(m.link.page, m.link.args ?? [])}>Open</a>}
            {m.actions && !m.resolved && (
              <div style={{ marginTop: 4 }}>
                {m.actions.map((a) => (
                  <button
                    key={a.key}
                    className="btn btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMessage(answerInbox(league, m, a.key));
                      changed();
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            {m.resolved && <div className="small muted">You chose: {m.resolved}</div>}
          </div>
        );
      })}
    </>
  );
}
