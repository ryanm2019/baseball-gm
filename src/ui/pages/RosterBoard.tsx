// OOTP-style roster overview: boxes for each roster, drag a player from one
// box to another to make the move (recall, option, select, add to 40, IL,
// DFA, release). Each box's list is chosen from a drop-down.
import { useState } from 'react';
import { useStore, changed, askConfirm, setMessage } from '../../store.ts';
import type { League, Level, Player } from '../../core/types.ts';
import { MINOR_LEVELS } from '../../core/types.ts';
import { activeAt, activeLimit, countPitchers, fortyMan, orgPlayers, pitcherLimit } from '../../core/util.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import type React from 'react';
import {
  activateFromIL,
  canActivate,
  canAssign,
  canOption,
  canPlaceIL,
  canTransferIL60,
  assignPlayer,
  optionPlayer,
  optionsLeft,
  placeIL,
  posLabel,
  transferIL60,
} from '../../core/rules.ts';
import { serviceYears } from '../../core/contracts.ts';
import { playerActions } from '../actions.ts';
import { PlayerCard } from '../PlayerCard.tsx';
import { avg, era, fmt3, ipStr, obp, seasonBat, seasonPit, slg, whip } from '../fmt.tsx';
import { batAdvanced, pitAdvanced, seasonCtx } from '../../core/war.ts';
import { isPitcher } from '../../core/ratings.ts';

type View = 'ratings' | 'hit' | 'pit';
interface Col { key: string; label: string; title?: string; left?: boolean; value: (p: Player) => number | string; render?: (p: Player) => React.ReactNode; asc?: boolean }

// This season's stats at the level he's at now (last season's in the winter).
function statSeason(league: League): number {
  return league.phase === 'offseason' || league.phase === 'preseason' ? league.season - (league.phase === 'preseason' ? 1 : 0) : league.season;
}

type Box = Level | '40' | 'IL' | 'IL60' | 'DFA';
const BOXES: Box[] = ['MLB', '40', ...MINOR_LEVELS, 'IL', 'IL60', 'DFA'];
const DEFAULT: Box[] = ['MLB', '40', 'AAA', 'IL', 'AA', 'DFA'];
const STORE_KEY = 'bgm-roster-board';

function boxName(league: League, b: Box): string {
  const org = league.orgs[league.userOrgId];
  if (b === '40') return '40-man (not active)';
  if (b === 'IL') return 'Injured list (10/15-day, MiLB 7-day)';
  if (b === 'IL60') return '60-day injured list';
  if (b === 'DFA') return 'Designated / waivers';
  if (b === 'MLB') return `Active roster (${org.affiliates.MLB.name})`;
  return `${b} ${org.affiliates[b].name}`;
}

function boxPlayers(league: League, b: Box): Player[] {
  const id = league.userOrgId;
  const all = orgPlayers(league, id);
  let ps: Player[];
  if (b === '40') ps = fortyMan(league, id).filter((p) => p.level !== 'MLB' && !p.il && !p.dfa && !p.waivers);
  else if (b === 'IL') ps = all.filter((p) => p.il && p.il.type !== 'IL60' && p.il.type !== 'MiLB60');
  else if (b === 'IL60') ps = all.filter((p) => p.il && (p.il.type === 'IL60' || p.il.type === 'MiLB60'));
  else if (b === 'DFA') ps = all.filter((p) => p.dfa || p.waivers);
  else ps = activeAt(league, id, b);
  const order = ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  return ps.sort((x, y) => order.indexOf(x.pos) - order.indexOf(y.pos) || scoutedOvr(league, y) - scoutedOvr(league, x));
}

function boxCount(league: League, b: Box, n: number): string {
  if (b === 'MLB') {
    const act = activeAt(league, league.userOrgId, 'MLB');
    return `${n}/${activeLimit(league)} · P ${countPitchers(act)}/${pitcherLimit(league)}`;
  }
  if (b === '40') return `40-man ${fortyMan(league, league.userOrgId).length}/${league.settings.fortyMax}`;
  if ((MINOR_LEVELS as Box[]).includes(b)) return `${n}/${league.settings.milbActiveMax[b as Level]}`;
  return `${n}`;
}

interface Move { reason: string | null; confirm?: string; run: () => void; label: string }

// What dropping p on box `to` means.
function moveFor(league: League, p: Player, to: Box): Move | null {
  const acts = playerActions(league, p);
  const act = (...keys: string[]): Move | null => {
    for (const k of keys) {
      const a = acts.find((x) => x.key === k);
      if (a) return a;
    }
    return null;
  };
  if (to === 'MLB') {
    if (p.il) {
      if (p.il.returnLevel !== 'MLB') return { label: 'Activate', reason: `Activate him to ${p.il.returnLevel} first`, run: () => {} };
      return act('activate');
    }
    return act('recall', 'select');
  }
  if (to === '40') return p.on40 ? { label: '', reason: 'Already on the 40-man roster', run: () => {} } : act('add40');
  if (to === 'IL') {
    if (p.il) return { label: '', reason: p.il.type === 'IL60' || p.il.type === 'MiLB60' ? "Players can't move back from the 60-day IL" : 'Already on the IL', run: () => {} };
    return { label: 'Place on IL', reason: canPlaceIL(league, p), run: () => placeIL(league, p, false) };
  }
  if (to === 'IL60') {
    if (p.il) return { label: 'Transfer to 60-day IL', reason: canTransferIL60(league, p), run: () => transferIL60(league, p) };
    return { label: 'Place on 60-day IL', reason: canPlaceIL(league, p), run: () => placeIL(league, p, true) };
  }
  if (to === 'DFA') return p.dfa ? act('waive') : act('dfa');
  // a minor league level
  const lvl = to as Level;
  if (p.il) {
    if (p.il.returnLevel === lvl) return { label: 'Activate', reason: canActivate(league, p), run: () => activateFromIL(league, p) };
    return { label: '', reason: `Activate him first (he returns to ${p.il.returnLevel})`, run: () => {} };
  }
  if (p.level === 'MLB' && p.on40) {
    const why = canOption(league, p);
    return { label: `Option to ${lvl}`, reason: why, run: () => optionPlayer(league, p, lvl) };
  }
  return { label: `Assign to ${lvl}`, reason: canAssign(league, p, lvl), run: () => assignPlayer(league, p, lvl) };
}

export default function RosterBoard() {
  const { league } = useStore();
  const [boxes, setBoxes] = useState<Box[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      if (Array.isArray(v) && v.length === 6 && v.every((x) => BOXES.includes(x))) return v;
    } catch { /* ignore */ }
    return DEFAULT;
  });
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [views, setViews] = useState<View[]>(['ratings', 'ratings', 'ratings', 'ratings', 'ratings', 'ratings']);
  const [sorts, setSorts] = useState<({ key: string; desc: boolean } | null)[]>([null, null, null, null, null, null]);
  if (!league) return null;
  const s = league.settings;

  const setBox = (i: number, b: Box) => {
    const next = boxes.map((x, j) => (j === i ? b : x));
    setBoxes(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const drop = async (to: Box | 'release', pid: number | null = drag) => {
    setOver(null);
    if (pid === null) return;
    const p = league.players[pid];
    setDrag(null);
    if (!p || p.orgId !== league.userOrgId) return;
    const m = to === 'release' ? playerActions(league, p).find((a) => a.key === 'release') ?? null : moveFor(league, p, to);
    if (!m) return setMessage(`Can't move ${p.first} ${p.last} there.`);
    if (m.reason) return setMessage(`${p.first} ${p.last}: ${m.reason}`);
    if (m.confirm && !(await askConfirm(m.confirm))) return;
    m.run();
    const tx = league.transactions[league.transactions.length - 1];
    setMessage(tx && tx.pids.includes(p.id) ? tx.text : `${m.label}: ${p.first} ${p.last}`);
    changed();
  };

  const flags = (p: Player) => {
    const out: string[] = [];
    if (p.on40 && serviceYears(p.mlServiceDays, s) >= s.optionConsentServiceYears) out.push('^');
    if (p.on40 && optionsLeft(league, p) === 0) out.push('°');
    if (p.rule5 && p.rule5.season === league.season) out.push('R5');
    return out.join(' ');
  };

  const season = statSeason(league);
  const bat = (p: Player) => seasonBat(p, season, p.level ?? undefined);
  const pit = (p: Player) => seasonPit(p, season, p.level ?? undefined);
  const ctx = (p: Player) => seasonCtx(league, season, p.level ?? 'AAA');
  const base: Col[] = [
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    {
      key: 'name', label: 'Player', left: true, value: (p) => p.last,
      render: (p) => <><span className={p.injury ? 'neg' : ''}>{p.first[0]}. {p.last}</span> <span className="muted small">{flags(p)}</span></>,
    },
    { key: 'age', label: 'Age', value: (p) => league.season - p.born },
  ];
  const colsFor = (v: View, b: Box): Col[] => {
    const tag40: Col = { key: 'f40', label: '40', title: 'On the 40-man roster', value: (p) => (p.on40 ? 1 : 0), render: (p) => (p.on40 && b !== 'MLB' && b !== '40' ? <span className="tag small">40</span> : '') };
    const lvl: Col = { key: 'lvl', label: 'Lvl', value: (p) => p.level ?? '' };
    if (v === 'hit') return [...base, lvl, tag40,
      { key: 'pa', label: 'PA', value: (p) => bat(p).pa },
      { key: 'avg', label: 'AVG', value: (p) => avg(bat(p)), render: (p) => fmt3(avg(bat(p))) },
      { key: 'obp', label: 'OBP', value: (p) => obp(bat(p)), render: (p) => fmt3(obp(bat(p))) },
      { key: 'slg', label: 'SLG', value: (p) => slg(bat(p)), render: (p) => fmt3(slg(bat(p))) },
      { key: 'hr', label: 'HR', value: (p) => bat(p).hr },
      { key: 'sb', label: 'SB', value: (p) => bat(p).sb },
      { key: 'kp', label: 'K%', value: (p) => (bat(p).pa ? bat(p).k / bat(p).pa : 0), render: (p) => (bat(p).pa ? ((100 * bat(p).k) / bat(p).pa).toFixed(1) : '-'), asc: true },
      { key: 'wrc', label: 'wRC+', title: 'Relative to his level (100 = average)', value: (p) => batAdvanced(bat(p), ctx(p)).wrcPlus },
    ];
    if (v === 'pit') return [...base, lvl, tag40,
      { key: 'g', label: 'G', value: (p) => pit(p).g },
      { key: 'ip', label: 'IP', value: (p) => pit(p).outs, render: (p) => ipStr(pit(p).outs) },
      { key: 'era', label: 'ERA', value: (p) => (pit(p).outs ? era(pit(p)) : 99), render: (p) => (pit(p).outs ? era(pit(p)).toFixed(2) : '-'), asc: true },
      { key: 'fip', label: 'FIP', value: (p) => (pit(p).outs ? pitAdvanced(pit(p), ctx(p)).fip : 99), render: (p) => (pit(p).outs ? pitAdvanced(pit(p), ctx(p)).fip.toFixed(2) : '-'), asc: true },
      { key: 'whip', label: 'WHIP', value: (p) => (pit(p).outs ? whip(pit(p)) : 99), render: (p) => (pit(p).outs ? whip(pit(p)).toFixed(2) : '-'), asc: true },
      { key: 'kbb', label: 'K-BB%', value: (p) => pitAdvanced(pit(p), ctx(p)).kbb, render: (p) => (pit(p).bf ? (pitAdvanced(pit(p), ctx(p)).kbb * 100).toFixed(1) : '-') },
      { key: 'sv', label: 'SV', value: (p) => pit(p).sv },
    ];
    return [...base, tag40,
      { key: 'ovr', label: 'Ovr', value: (p) => scoutedOvr(league, p) },
      { key: 'pot', label: 'Pot', value: (p) => scoutedPot(league, p) },
      { key: 'mood', label: 'Mood', title: 'Morale (50 = content)', value: (p) => p.morale?.value ?? 55, render: (p) => (p.morale ? <span className={p.morale.value < 35 ? 'neg' : p.morale.value >= 65 ? 'pos' : ''}>{Math.round(p.morale.value)}</span> : '-') },
      { key: 'opt', label: 'Opt', title: 'Option years left', value: (p) => (p.on40 || p.contract.type === 'ML' ? optionsLeft(league, p) : -1), render: (p) => (p.on40 || p.contract.type === 'ML' ? optionsLeft(league, p) : '-') },
      { key: 'svc', label: 'Svc', title: 'MLB service years', value: (p) => serviceYears(p.mlServiceDays, s), render: (p) => serviceYears(p.mlServiceDays, s).toFixed(3) },
      {
        key: 'status', label: 'Status', left: true, value: (p) => (p.injury ? p.injury.daysLeft : 0),
        render: (p) => <span className="small">{p.injury ? `${p.injury.name} (${p.injury.daysLeft}d)` : ''}{p.il ? ` ${p.il.type}` : ''}{p.rehab ? ` · rehab ${p.rehab.level} (${p.rehab.daysLeft}d)` : ''}{p.dfa ? ' DFA' : ''}{p.waivers ? ' waivers' : ''}</span>,
      },
    ];
  };
  const sortRows = (ps: Player[], cols: Col[], sort: { key: string; desc: boolean } | null) => {
    if (!sort) return ps;
    const c = cols.find((x) => x.key === sort.key);
    if (!c) return ps;
    return [...ps].sort((a, b) => {
      const x = c.value(a);
      const y = c.value(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -r : r;
    });
  };

  const shown = sel !== null ? league.players[sel] : null;
  return (
    <>
      <h1>Roster Moves</h1>
      <p className="muted small">
        Drag a player from one box to another to make the move: onto the active roster to recall, select or activate him; onto a minor league box to option or assign; onto the 40-man box to add him; onto an injured list; onto Designated to DFA him (or send a DFA'd player to outright waivers); or onto the release bar. Pick what each box shows from its drop-down. Tap a player to see his ratings; on a phone, tap him and then "Move here" on the box you want.
      </p>
      <p className="muted small">Switch a box to Hitting or Pitching to compare this season's stats at each player's level (wRC+ and FIP are relative to that level); click a column to sort. ^ can refuse an option (5+ years of service) · ° out of options · R5 Rule 5 pick (must stay active) · Opt = option years left · Svc = MLB service years</p>
      <div className="board">
        {boxes.map((b, i) => {
          const all = boxPlayers(league, b);
          const v = views[i];
          const ps = v === 'hit' ? all.filter((p) => !isPitcher(p)) : v === 'pit' ? all.filter(isPitcher) : all;
          const cols = colsFor(v, b);
          const rows = sortRows(ps, cols, sorts[i]);
          return (
            <div
              key={i}
              className={`board-box${over === i ? ' over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(i); }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => { e.preventDefault(); void drop(b); }}
            >
              <div className="board-head">
                <select value={b} onChange={(e) => setBox(i, e.target.value as Box)}>
                  {BOXES.map((x) => <option key={x} value={x}>{boxName(league, x)}</option>)}
                </select>
                <span className="nowrap">
                  <select className="small" value={v} onChange={(e) => { setViews(views.map((x, j) => (j === i ? (e.target.value as View) : x))); setSorts(sorts.map((x, j) => (j === i ? null : x))); }}>
                    <option value="ratings">Ratings</option><option value="hit">Hitting {season}</option><option value="pit">Pitching {season}</option>
                  </select>{' '}
                  <span className="small muted">{boxCount(league, b, all.length)}</span>
                  {sel !== null && !all.some((p) => p.id === sel) && <button className="btn btn-sm btn-primary" style={{ marginLeft: 6 }} onClick={() => { void drop(b, sel); setSel(null); }}>Move here</button>}
                </span>
              </div>
              <div className="board-list">
                <table className="data compact">
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th
                          key={c.key}
                          className={`${c.left ? 'l ' : ''}sortable`}
                          title={c.title ?? 'Sort'}
                          onClick={() => setSorts(sorts.map((x, j) => (j === i ? { key: c.key, desc: x?.key === c.key ? !x.desc : !c.asc } : x)))}
                        >
                          {c.label}{sorts[i]?.key === c.key ? (sorts[i]!.desc ? ' ▾' : ' ▴') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr
                        key={p.id}
                        draggable
                        className={`draggable${drag === p.id ? ' dragging' : ''}${sel === p.id ? ' sel' : ''}`}
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(p.id)); setDrag(p.id); }}
                        onDragEnd={() => { setDrag(null); setOver(null); }}
                        onClick={() => setSel(sel === p.id ? null : p.id)}
                      >
                        {cols.map((c) => <td key={c.key} className={c.left ? 'l' : ''}>{c.render ? c.render(p) : c.value(p)}</td>)}
                      </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={cols.length} className="muted small">Empty</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      <div
        className={`board-release${over === -1 ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(-1); }}
        onDragLeave={() => setOver((o) => (o === -1 ? null : o))}
        onDrop={(e) => { e.preventDefault(); void drop('release'); }}
      >
        Drop here to release
        {sel !== null && <> · <button className="btn btn-sm btn-danger" onClick={() => { void drop('release', sel); setSel(null); }}>Release {league.players[sel]?.last}</button></>}
      </div>
      {shown && <div style={{ marginTop: 16 }}><PlayerCard league={league} p={shown} level={shown.level ?? 'AAA'} /></div>}
    </>
  );
}
