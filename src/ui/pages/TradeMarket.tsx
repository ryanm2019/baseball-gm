import { useStore, changed } from '../../store.ts';
import { href, go, useRoute } from '../../router.ts';
import type { Player, Pos } from '../../core/types.ts';
import { NEED_POS, STANCE_HELP, teamNeeds } from '../../core/market.ts';
import { posLabel } from '../../core/rules.ts';
import { DataTable, type Column } from '../components.tsx';
import { tradePlayerCols } from '../tradeCols.tsx';


export default function TradeMarket() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const user = league.orgs[league.userOrgId];
  const pos = (route.query.pos ?? '') as Pos | '';
  const st = league.standings.MLB;

  const teams = league.orgs.map((o) => ({ o, needs: teamNeeds(league, o.id) }));
  const teamCols: Column<(typeof teams)[0]>[] = [
    { key: 'team', label: 'Team', left: true, value: (r) => r.o.abbrev, render: (r) => <a href={href('roster', [], { org: r.o.id })}>{r.o.region} {r.o.name}</a> },
    { key: 'rec', label: 'W-L', value: (r) => st[r.o.id].w - st[r.o.id].l, render: (r) => `${st[r.o.id].w}-${st[r.o.id].l}`, sortDesc: true },
    { key: 'strategy', label: 'Direction', left: true, value: (r) => r.o.strategy, render: (r) => ({ Contend: 'Contending', Retool: 'Retooling', Rebuild: 'Rebuilding' })[r.o.strategy] },
    { key: 'stance', label: 'Stance', left: true, value: (r) => r.o.stance, render: (r) => <span title={STANCE_HELP[r.o.stance]} className={r.o.stance === 'Buying' ? 'pos' : r.o.stance === 'Selling' ? 'neg' : ''}>{r.o.stance}</span> },
    { key: 'needs', label: 'Looking for', left: true, value: (r) => r.needs.join(' '), render: (r) => r.needs.join(', ') || <span className="muted">-</span> },
    {
      key: 'block',
      label: 'On the block',
      left: true,
      value: (r) => r.o.block.length,
      sortDesc: true,
      render: (r) => {
        const ps = r.o.block.map((id) => league.players[id]).filter(Boolean);
        if (!ps.length) return <span className="muted">-</span>;
        return (
          <span className="small">
            {ps.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ', '}
                <a href={href('player', [p.id])}>{p.last}</a> <span className="muted">{posLabel(p)} {p.level}</span>
              </span>
            ))}
          </span>
        );
      },
    },
    { key: 'go', label: '', noSort: true, render: (r) => r.o.id === user.id ? <a href={href('trading-block')}>Your block</a> : <a href={href('trade', [], { org: r.o.id })}>Trade</a> },
  ];

  const block: Player[] = league.orgs
    .filter((o) => o.id !== user.id)
    .flatMap((o) => o.block.map((id) => league.players[id]))
    .filter((p) => p && p.orgId !== null && (!pos || p.pos === pos));
  const playerCols: Column<Player>[] = [
    { key: 'name', label: 'Name', left: true, value: (p) => `${p.last} ${p.first}`, render: (p) => <a href={href('player', [p.id])}>{p.first} {p.last}</a> },
    { key: 'team', label: 'Team', value: (p) => league.orgs[p.orgId!].abbrev },
    { key: 'stance', label: 'Stance', left: true, value: (p) => league.orgs[p.orgId!].stance },
    ...tradePlayerCols(league),
    {
      key: 'act',
      label: '',
      noSort: true,
      render: (p) => (
        <span className="nowrap">
          <a className="btn btn-sm" href={href('trade', [], { org: p.orgId!, pid: p.id })}>Trade for</a>{' '}
          <button
            className="btn btn-sm"
            onClick={() => {
              user.interest.pids = user.interest.pids.includes(p.id) ? user.interest.pids.filter((x) => x !== p.id) : [...user.interest.pids, p.id];
              changed();
            }}
          >
            {user.interest.pids.includes(p.id) ? 'Unwatch' : 'Watch'}
          </button>
        </span>
      ),
    },
  ];

  return (
    <>
      <h1>Trade Market</h1>
      <p className="muted small">What every club is signaling. Stances shift with the standings before the deadline and again each winter. Sellers shop veterans; buyers dangle upper-minors prospects; clubs listening shop their spare parts. Players on a block are tagged "block" everywhere they appear.</p>
      <DataTable cols={teamCols} rows={teams} rowKey={(r) => r.o.id} rowClass={(r) => (r.o.id === user.id ? 'user' : '')} defaultSort={{ key: 'rec', desc: true }} compact />
      <h2>Players on the block</h2>
      <div className="btn-group tabs">
        <button className={`btn btn-sm${!pos ? ' active' : ''}`} onClick={() => go('trade-market')}>All</button>
        {NEED_POS.map((p) => (
          <button key={p} className={`btn btn-sm${pos === p ? ' active' : ''}`} onClick={() => go('trade-market', [], { pos: p })}>{p}</button>
        ))}
      </div>
      {block.length === 0 ? <p className="muted">Nobody at that position is being shopped right now.</p> : <DataTable cols={playerCols} rows={block} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />}
    </>
  );
}
