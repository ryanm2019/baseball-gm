// OOTP-style roster overview: boxes for each roster, drag a player from one
// box to another to make the move (recall, option, select, add to 40, IL,
// DFA, release). Each box's list is chosen from a drop-down.
import { useState } from 'react';
import { useStore, changed, askConfirm, setMessage } from '../../store.ts';
import type { League, Level, Player } from '../../core/types.ts';
import { MINOR_LEVELS } from '../../core/types.ts';
import { activeAt, activeLimit, countPitchers, fortyMan, orgPlayers, pitcherLimit } from '../../core/util.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
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
  if (!league) return null;
  const s = league.settings;

  const setBox = (i: number, b: Box) => {
    const next = boxes.map((x, j) => (j === i ? b : x));
    setBoxes(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const drop = async (to: Box | 'release') => {
    setOver(null);
    if (drag === null) return;
    const p = league.players[drag];
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

  const shown = sel !== null ? league.players[sel] : null;
  return (
    <>
      <h1>Roster Moves</h1>
      <p className="muted small">
        Drag a player from one box to another to make the move: onto the active roster to recall, select or activate him; onto a minor league box to option or assign; onto the 40-man box to add him; onto an injured list; onto Designated to DFA him (or send a DFA'd player to outright waivers); or onto the release bar. Pick what each box shows from its drop-down. Click a name for his ratings.
      </p>
      <p className="muted small">^ can refuse an option (5+ years of service) · ° out of options · R5 Rule 5 pick (must stay active) · Opt = option years left · Svc = MLB service years</p>
      <div className="board">
        {boxes.map((b, i) => {
          const ps = boxPlayers(league, b);
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
                <span className="small muted">{boxCount(league, b, ps.length)}</span>
              </div>
              <div className="board-list">
                <table className="data compact">
                  <thead><tr><th>Pos</th><th className="l">Player</th><th>Age</th><th>Ovr</th><th>Pot</th><th title="Option years left">Opt</th><th title="MLB service years">Svc</th><th className="l">Status</th></tr></thead>
                  <tbody>
                    {ps.map((p) => (
                      <tr
                        key={p.id}
                        draggable
                        className={`draggable${drag === p.id ? ' dragging' : ''}${sel === p.id ? ' sel' : ''}`}
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(p.id)); setDrag(p.id); }}
                        onDragEnd={() => { setDrag(null); setOver(null); }}
                        onClick={() => setSel(sel === p.id ? null : p.id)}
                      >
                        <td>{posLabel(p)}</td>
                        <td className="l">
                          <span className={p.injury ? 'neg' : ''}>{p.first[0]}. {p.last}</span> <span className="muted small">{flags(p)}</span>
                          {b !== 'MLB' && b !== '40' && p.on40 && <span className="tag small"> 40</span>}
                        </td>
                        <td>{league.season - p.born}</td>
                        <td>{scoutedOvr(league, p)}</td>
                        <td>{scoutedPot(league, p)}</td>
                        <td>{p.on40 || p.contract.type === 'ML' ? optionsLeft(league, p) : '-'}</td>
                        <td>{serviceYears(p.mlServiceDays, s).toFixed(3)}</td>
                        <td className="l small">
                          {p.injury ? `${p.injury.name} (${p.injury.daysLeft}d)` : ''}
                          {p.il ? ` ${p.il.type}` : ''}
                          {p.dfa ? ' DFA' : ''}
                          {p.waivers ? ' waivers' : ''}
                        </td>
                      </tr>
                    ))}
                    {!ps.length && <tr><td colSpan={8} className="muted small">Empty</td></tr>}
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
      </div>
      {shown && <div style={{ marginTop: 16 }}><PlayerCard league={league} p={shown} level={shown.level ?? 'AAA'} /></div>}
    </>
  );
}
