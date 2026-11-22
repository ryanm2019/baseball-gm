// Messages from agents, the owner, your staff and other clubs. Some ask for a
// decision; promises you make are checked later.
import { useState } from 'react';
import { answerCounter } from '../../core/negotiation.ts';
import { answerIlReady } from '../../core/farmDirector.ts';
import { loadTrade } from './Trade.tsx';
import { useStore, changed, setMessage } from '../../store.ts';
import { go, href } from '../../router.ts';
import { answerInbox, moraleLabel } from '../../core/morale.ts';
import { answerStory } from '../../core/storylines.ts';
import { answerPosition, answerSeptember } from '../../core/positions.ts';
import { canRecall, canSelect, recallPlayer, selectContract } from '../../core/rules.ts';
import { answerInjury } from '../../core/injuries.ts';
import { dayShort } from '../../core/settings.ts';
import { DataTable, LinkedText, type Column } from '../components.tsx';
import { tradePlayerCols } from '../tradeCols.tsx';
import type { League, Player } from '../../core/types.ts';

// Ratings plus this season's numbers (every level he's played) for the players a message is about.
function PlayerCards({ league, pids }: { league: League; pids: number[] }) {
  const rows = pids.map((id) => league.players[id]).filter((p): p is Player => !!p);
  if (!rows.length) return null;
  const rat = tradePlayerCols(league, 'ratings').filter((c) => ['pos', 'age', 'lvl', 'ovr', 'pot'].includes(c.key));
  const st = tradePlayerCols(league, 'stats').filter((c) => ['n', 'wrc', 'fipm', 'line'].includes(c.key));
  const cols: Column<Player>[] = [
    { key: 'name', label: 'Player', left: true, value: (p) => p.last, render: (p) => <a href={href('player', [p.id])}>{p.first} {p.last}</a> },
    // Players from more than one club (trade talk): show whose he is.
    ...(new Set(rows.map((p) => p.orgId)).size > 1 ? [{ key: 'team', label: 'Team', value: (p: Player) => (p.orgId === null ? 'FA' : league.orgs[p.orgId].abbrev) }] : []),
    ...rat, ...st,
  ];
  return <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}><DataTable cols={cols} rows={rows} rowKey={(p) => p.id} compact /></div>;
}

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
            {m.pids.length > 0 && <PlayerCards league={league} pids={m.pids} />}
            {m.link && <a className="small" href={href(m.link.page, m.link.args ?? [], m.link.query ?? {})}>Open</a>}
            {m.actions && !m.resolved && (
              <div style={{ marginTop: 4 }}>
                {m.actions.map((a) => (
                  <button
                    key={a.key}
                    className="btn btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (m.kind === 'september') {
                        m.resolved = a.label;
                        m.read = true;
                        setMessage(answerSeptember(league, m.pids, a.key, (p) => { const why = p.on40 ? canRecall(league, p) : canSelect(league, p); if (!why) { if (p.on40) recallPlayer(league, p); else selectContract(league, p); } return why; }));
                      } else if (m.kind === 'injury') {
                        m.resolved = a.label;
                        m.read = true;
                        setMessage(answerInjury(league, m.pids[0], a.key));
                      } else if (m.kind === 'trade-reply') {
                        const t = (league.tradeTalks ?? []).find((x) => x.id === m.talkId);
                        const counter = t?.counter;
                        setMessage(answerCounter(league, m, a.key));
                        if (a.key === 'revise' && t && counter) { loadTrade(t.orgId, [counter.give[0], counter.give[1]]); go('trade'); }
                      } else if (m.kind === 'il-ready') {
                        setMessage(answerIlReady(league, m, a.key));
                      } else if (m.kind === 'position') {
                        m.resolved = a.label;
                        m.read = true;
                        setMessage(answerPosition(league, m.pids[0], a.key));
                      } else setMessage(answerStory(league, m, a.key) ?? answerInbox(league, m, a.key));
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
