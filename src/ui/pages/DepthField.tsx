// The depth chart drawn on a field: who plays each position, his backups, how
// he ranks around the league, and the prospects coming at that spot.
import type React from 'react';
import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
import type { League, Org, Player, Pos } from '../../core/types.ts';
import { activeAt, orgPlayers } from '../../core/util.ts';
import { defAt, isPitcher, ovr, scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { ovrAt, positionReads } from '../../core/positions.ts';
import { buildLineup } from '../../core/sim/lineup.ts';
import { HeatIcon } from '../show.tsx';
import { orgPayroll, fmtMoney } from '../../core/contracts.ts';
import { acquisition } from '../../core/moves.ts';
import { ContractCell } from '../fmt.tsx';

type Spot = Pos | 'SP' | 'RP';
const FIELD: Pos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
// Where each card sits on the field (percent of the field box: left, top).
const AT: Record<Spot, [number, number]> = {
  LF: [14, 7], CF: [50, 2], RF: [86, 7],
  SS: [33, 27], '2B': [67, 27],
  '3B': [15, 47], SP: [50, 41], '1B': [85, 47],
  C: [50, 75], DH: [14, 77], RP: [86, 72],
};
const ORDER: Pos[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B', 'DH'];
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

// A club's best player at each position, filled greedily from the toughest
// spots (so every club is measured the same way for the league ranks).
function bestAtPositions(league: League, org: Org): Map<Pos, number> {
  const hitters = activeAt(league, org.id, 'MLB').filter((p) => !isPitcher(p) && !p.injury);
  const used = new Set<number>();
  const out = new Map<Pos, number>();
  for (const pos of ORDER) {
    const best = hitters.filter((p) => !used.has(p.id)).sort((a, b) => ovrAt(b, pos) - ovrAt(a, pos))[0];
    if (!best) continue;
    used.add(best.id);
    out.set(pos, ovrAt(best, pos));
  }
  return out;
}
const staffOvr = (league: League, org: Org, role: 'SP' | 'RP', n: number) => {
  const ps = activeAt(league, org.id, 'MLB').filter((p) => p.pos === role && !p.injury).map(ovr).sort((a, b) => b - a).slice(0, n);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / n : 0;
};
// Rank (1 = best) of `mine` among every club's value.
const rankOf = (mine: number, all: number[]) => 1 + all.filter((v) => v > mine + 1e-9).length;

function Row({ league, p, note, star }: { league: League; p: Player; note?: string; star?: boolean }) {
  return (
    <div className={`fp-row${star ? ' fp-star' : ''}`}>
      <span className="fp-name"><a href={href('player', [p.id])} title={acquisition(league, p)?.text ?? ''}>{p.first[0]}. {p.last}</a><HeatIcon league={league} p={p} />{note && <span className="fp-note">{note}</span>}</span>
      <span className="fp-num" title="Overall / potential (your scouts)">{Math.round(scoutedOvr(league, p))}/{Math.round(scoutedPot(league, p))}</span>
      <span className="fp-meta">{league.season - p.born}</span>
      <span className="fp-meta fp-ctr"><ContractCell league={league} p={p} compact /></span>
    </div>
  );
}

function Rank({ r, label }: { r: number; label?: string }) {
  const cls = r <= 10 ? 'fp-rank good' : r >= 21 ? 'fp-rank bad' : 'fp-rank';
  return <span className={cls} title={`${label ?? 'League rank'}: ${ord(r)} of 30`}>{ord(r)}</span>;
}

export default function DepthField() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const active = activeAt(league, org.id, 'MLB');
  const hitters = active.filter((p) => !isPitcher(p));
  const minors = orgPlayers(league, org.id).filter((p) => p.level && p.level !== 'MLB');

  // Your lineup (vs right-handers): the saved card, or the auto lineup.
  const saved = org.depth.MLB;
  const lu = saved && !saved.auto ? saved.lineup : buildLineup(league, org.id, 'MLB')?.batters.map((b) => ({ pid: b.p.id, pos: b.pos })) ?? [];
  const starter = new Map<Pos, Player>();
  for (const s of lu) { const p = league.players[s.pid]; if (p) starter.set(s.pos, p); }

  // League ranks.
  const best = new Map(league.orgs.map((o) => [o.id, bestAtPositions(league, o)]));
  const posRank = (pos: Pos) => {
    const mine = starter.get(pos);
    if (!mine) return 30;
    return rankOf(ovrAt(mine, pos), league.orgs.filter((o) => o.id !== org.id).map((o) => best.get(o.id)!.get(pos) ?? 0));
  };
  const avgOf = (o: Org, f: (m: Map<Pos, number>) => number) => f(best.get(o.id)!);
  const lineupVal = (m: Map<Pos, number>) => [...m.values()].reduce((a, b) => a + b, 0) / 9;
  const defVal = (o: Org) => {
    const hs = activeAt(league, o.id, 'MLB').filter((p) => !isPitcher(p));
    return (['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const).reduce((t, pos) => t + Math.max(0, ...hs.map((p) => defAt(p, pos))), 0) / 8;
  };
  const myLineup = [...starter.entries()].reduce((t, [pos, p]) => t + ovrAt(p, pos), 0) / 9;
  const ranks = {
    Lineup: rankOf(myLineup, league.orgs.filter((o) => o.id !== org.id).map((o) => avgOf(o, lineupVal))),
    Rotation: rankOf(staffOvr(league, org, 'SP', 5), league.orgs.filter((o) => o.id !== org.id).map((o) => staffOvr(league, o, 'SP', 5))),
    Bullpen: rankOf(staffOvr(league, org, 'RP', 7), league.orgs.filter((o) => o.id !== org.id).map((o) => staffOvr(league, o, 'RP', 7))),
    Defense: rankOf(defVal(org), league.orgs.filter((o) => o.id !== org.id).map(defVal)),
    Payroll: rankOf(orgPayroll(league, org).cbt, league.orgs.filter((o) => o.id !== org.id).map((o) => orgPayroll(league, o).cbt)),
  };
  const overall = rankOf(-(ranks.Lineup + ranks.Rotation + ranks.Bullpen + ranks.Defense), league.orgs.filter((o) => o.id !== org.id).map((o) => {
    const r = (v: number, all: number[]) => rankOf(v, all);
    const others = league.orgs.filter((x) => x.id !== o.id);
    return -(r(avgOf(o, lineupVal), others.map((x) => avgOf(x, lineupVal))) + r(staffOvr(league, o, 'SP', 5), others.map((x) => staffOvr(league, x, 'SP', 5))) + r(staffOvr(league, o, 'RP', 7), others.map((x) => staffOvr(league, x, 'RP', 7))) + r(defVal(o), others.map(defVal)));
  }));

  // Backups: other active hitters your scouts think can handle the spot.
  // Bench players first; a starter from another spot only if the bench has nobody.
  const starters = new Set([...starter.values()].map((p) => p.id));
  const backups = (pos: Pos, s?: Player) => {
    const fits = hitters.filter((p) => p !== s).map((p) => ({ p, r: positionReads(league, org, p).find((x) => x.pos === pos)!, starts: starters.has(p.id) }))
      .filter((x) => x.r && (pos === 'DH' || x.r.fit === 'Natural' || x.r.fit === 'Good fit' || x.r.fit === 'Can handle it'))
      .sort((a, b) => Number(a.starts) - Number(b.starts) || scoutedOvr(league, b.p) - scoutedOvr(league, a.p));
    const bench = fits.filter((x) => !x.starts);
    return (bench.length ? bench : fits).slice(0, 2);
  };
  const startsAt = (p: Player) => [...starter.entries()].find(([, q]) => q === p)?.[0];
  const prospects = (match: (p: Player) => boolean) => minors.filter(match).sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a)).slice(0, 2);

  // Pitching staff.
  const rotationIds = saved && !saved.auto && saved.rotation.length ? saved.rotation : active.filter((p) => p.pos === 'SP').sort((a, b) => scoutedOvr(league, b) - scoutedOvr(league, a)).slice(0, 5).map((p) => p.id);
  const rotation = rotationIds.map((id) => league.players[id]).filter((p): p is Player => !!p);
  const pen = active.filter((p) => isPitcher(p) && !rotation.includes(p)).sort((a, b) => scoutedOvr(league, b) - scoutedOvr(league, a));
  const closer = saved?.closer ? league.players[saved.closer] : pen[0];

  const card = (spot: Spot, body: React.ReactNode, rank: number | null, title?: string) => {
    const [x, y] = AT[spot];
    return (
      <div key={spot} className="fp-card" style={{ left: `${x}%`, top: `${y}%` }}>
        <div className="fp-head"><b>{title ?? spot}</b>{rank !== null && <Rank r={rank} />}</div>
        {body}
      </div>
    );
  };

  return (
    <div className="show">
      <h1>Depth Chart: Field View</h1>
      <p className="muted small">
        Starters (your lineup vs right-handers), their backups and the top prospects at each spot. The badge is where your starter ranks among the 30 clubs at that position (green top 10, red bottom 10). Hover a name to see how he was acquired. <a href={href('depth')}>Edit the depth chart</a>
      </p>
      <div className="fp-summary">
        <span>Payroll (CBT) <b>{fmtMoney(orgPayroll(league, org).cbt)}</b></span>
        <span>Overall <Rank r={overall} /></span>
        {Object.entries(ranks).map(([k, r]) => <span key={k}>{k} <Rank r={r} label={k === 'Payroll' ? 'Payroll rank (1 = highest)' : undefined} /></span>)}
      </div>
      <div className="fp-field">
        <svg className="fp-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M50 92 L10 52 L50 12 L90 52 Z" className="fp-infield" />
          <path d="M50 92 L-5 37 M50 92 L105 37" className="fp-foul" />
          <path d="M-5 37 Q50 -25 105 37" className="fp-fence" />
        </svg>
        {FIELD.map((pos) => {
          const s = starter.get(pos);
          const bk = backups(pos, s);
          const pr = pos === 'DH' ? [] : prospects((p) => p.pos === pos);
          return card(pos, (
            <>
              {s ? <Row league={league} p={s} star /> : <div className="fp-row neg">Nobody</div>}
              {bk.map((b) => <Row key={b.p.id} league={league} p={b.p} note={b.starts ? `starts ${startsAt(b.p)}` : pos === 'DH' || b.r.fit === 'Natural' ? undefined : b.r.fit === 'Good fit' ? 'good fit' : 'can play'} />)}
              {pr.map((p) => <Row key={p.id} league={league} p={p} note={p.level ?? ''} />)}
            </>
          ), posRank(pos));
        })}
        {card('SP', (
          <>
            {rotation.map((p, i) => <Row key={p.id} league={league} p={p} note={`#${i + 1}`} star={i === 0} />)}
            {prospects((p) => p.pos === 'SP').map((p) => <Row key={p.id} league={league} p={p} note={p.level ?? ''} />)}
          </>
        ), ranks.Rotation, 'Rotation')}
        {card('RP', (
          <>
            {closer && <Row league={league} p={closer} note="CL" star />}
            {pen.filter((p) => p !== closer).slice(0, 6).map((p) => <Row key={p.id} league={league} p={p} />)}
            {prospects((p) => p.pos === 'RP').map((p) => <Row key={p.id} league={league} p={p} note={p.level ?? ''} />)}
          </>
        ), ranks.Bullpen, 'Bullpen')}
      </div>
      <p className="muted small">Prospect rows show their level (AAA, AA...). Backups show how well your scouts think they fit the spot (Natural fits show no tag).</p>
    </div>
  );
}
