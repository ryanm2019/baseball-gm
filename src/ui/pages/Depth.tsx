import { useEffect, useState } from 'react';
import { playedSeason, positionGames, posGamesText } from '../../core/positions.ts';
import type React from 'react';
import { useStore, changed } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { DepthChart, Level, PenRole, Player, Pos } from '../../core/types.ts';
import { PEN_ROLES } from '../../core/types.ts';
import { activeAt, playersAt } from '../../core/util.ts';
import { defAt, isPitcher, scoutedOvr } from '../../core/ratings.ts';
import { battingOrder, buildLineup, restDays, rotationOf, suggestLineup } from '../../core/sim/lineup.ts';
import { LevelTabs } from '../components.tsx';
import { posLabel } from '../../core/rules.ts';
import { depthSeason, HIT_HEAD, HitCells, StarterLine, type StatWhen } from '../depthStats.tsx';
import { gradeClass, HeatIcon, ShowHeader } from '../show.tsx';
import { era, seasonPit } from '../fmt.tsx';

const POSITIONS: Pos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

// The auto lineup includes random rest days, so build it once per roster state
// rather than on every redraw (otherwise players shuffle while you drag).
let autoCache: { key: string; d: DepthChart } | null = null;
// Which season's stats the chart shows (kept while you move around).
let statWhen: StatWhen = 'this';

export default function Depth() {
  const { league, version } = useStore();
  const route = useRoute();
  const level = (route.query.level ?? 'MLB') as Level;
  const [draft, setDraft] = useState<{ key: string; d: DepthChart } | null>(null);
  const [drag, setDrag] = useState<{ from: 'lineup' | 'bench' | 'rot' | 'pen'; i: number; pid: number } | null>(null);
  const [tab, setTab] = useState<'lineup' | 'pitching'>('lineup');
  const [posMenu, setPosMenu] = useState<number | null>(null);
  const [roleMenu, setRoleMenu] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPosMenu(null); setRoleMenu(null); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const [vs, setVs] = useState<'R' | 'L'>('R');
  const [when, setWhen] = useState<StatWhen>(statWhen);
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const roster = activeAt(league, org.id, level).filter((p) => !p.injury);
  const season = depthSeason(league, when);
  const healthyHitters = roster.filter((p) => !isPitcher(p));
  const pitchers = roster.filter(isPitcher);
  // Everyone you can write into the lineup: active hitters, plus injured or IL
  // hitters at this level (they're subbed for until they're back).
  const hitters = [
    ...healthyHitters,
    ...playersAt(league, org.id, level).filter((p) => !isPitcher(p) && !healthyHitters.includes(p) && !p.dfa && !p.waivers),
  ];
  const outReason = (p: Player): string | null => (p.il ? p.il.type : p.injury ? 'Injured' : healthyHitters.includes(p) ? null : 'Unavailable');
  const key = `${level}-${version}`;

  const current = (): DepthChart => {
    const saved = org.depth[level];
    if (saved && !saved.auto) {
      const c = JSON.parse(JSON.stringify(saved)) as DepthChart;
      if (!c.pen) {
        const lu = buildLineup(league, org.id, level);
        c.pen = lu ? Object.fromEntries([...lu.roles.entries()]) : {};
      }
      return c;
    }
    if (autoCache?.key !== `${league.id}-${key}`) {
      const lu = buildLineup(league, org.id, level);
      const luL = buildLineup(league, org.id, level, 'L');
      autoCache = {
        key: `${league.id}-${key}`,
        d: {
          auto: saved?.auto ?? true,
          lineup: lu ? lu.batters.map((b) => ({ pid: b.p.id, pos: b.pos })) : [],
          lineupL: luL ? luL.batters.map((b) => ({ pid: b.p.id, pos: b.pos })) : undefined,
          rotation: [],
          closer: lu?.closer?.id ?? null,
          setup: lu?.setup.map((p) => p.id) ?? [],
          pen: lu ? Object.fromEntries([...lu.roles.entries()]) : {},
        },
      };
    }
    return JSON.parse(JSON.stringify(autoCache.d)) as DepthChart;
  };
  const d = draft?.key === key ? draft.d : current();
  // The card being edited: vs right-handers (the default lineup) or vs left-handers.
  const cardOf = (x: DepthChart) => {
    if (vs === 'R') return x.lineup;
    if (!x.lineupL || x.lineupL.length !== 9) x.lineupL = JSON.parse(JSON.stringify(x.lineup));
    return x.lineupL!;
  };
  const update = (fn: (x: DepthChart) => void) => {
    const x = JSON.parse(JSON.stringify(d)) as DepthChart;
    fn(x);
    setDraft({ key, d: x });
  };
  if (d.rotation.length === 0) {
    // Auto: the rotation the manager actually uses.
    d.rotation = rotationOf(league, org.id, level, pitchers, undefined).map((p) => p.id);
    if (d.rotation.length === 0) d.rotation = [...pitchers].sort((a, b) => (b.pos === 'SP' ? 1 : 0) - (a.pos === 'SP' ? 1 : 0) || scoutedOvr(league, b) - scoutedOvr(league, a)).slice(0, 5).map((p) => p.id);
  }
  while (d.lineup.length < 9) d.lineup.push({ pid: healthyHitters[d.lineup.length]?.id ?? 0, pos: POSITIONS[d.lineup.length] });
  const cur = cardOf(d);
  // A player who has since left the level keeps his slot until you replace him.
  for (const s of [...d.lineup, ...(d.lineupL ?? [])]) {
    const p = league.players[s.pid];
    if (p && !hitters.includes(p) && p.orgId === org.id && !isPitcher(p)) hitters.push(p);
  }
  const bench = hitters.filter((h) => !cur.some((s) => s.pid === h.id));

  // Drop onto lineup spot i: a lineup player moves to that spot (with his
  // position); a bench player takes over that spot's position.
  const drop = (i: number) => {
    if (!drag || (drag.from !== 'lineup' && drag.from !== 'bench')) return;
    update((x) => {
      if (drag.from === 'lineup') {
        const c = cardOf(x);
        const [moved] = c.splice(drag.i, 1);
        c.splice(i, 0, moved);
      } else {
        const c = cardOf(x);
        c[i] = { pid: drag.pid, pos: c[i].pos };
      }
    });
    setDrag(null);
    setOver(null);
  };

  const ids = cur.map((s) => s.pid);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const posList = cur.map((s) => s.pos);
  const missingPos = POSITIONS.filter((p) => !posList.includes(p));
  const valid = dupes.length === 0 && missingPos.length === 0 && ids.every((id) => hitters.some((h) => h.id === id)) && d.closer !== null;
  const dirty = draft?.key === key;
  const relievers = pitchers.filter((p) => !d.rotation.includes(p.id));
  const roleOf = (pid: number): PenRole => (d.closer === pid ? 'CL' : d.setup.includes(pid) ? 'SU' : d.pen?.[pid] && d.pen[pid] !== 'CL' && d.pen[pid] !== 'SU' ? d.pen[pid] : 'MR');
  const setRole = (pid: number, role: PenRole) =>
    update((x) => {
      x.pen ??= {};
      for (const r of relievers) x.pen[r.id] ??= roleOf(r.id);
      if (x.closer === pid) x.closer = null;
      x.setup = x.setup.filter((id) => id !== pid);
      if (role === 'CL') {
        if (x.closer !== null) x.pen[x.closer] = 'MR';
        x.closer = pid;
      } else if (role === 'SU') {
        // A third setup man bumps the second one to middle relief.
        if (x.setup.length >= 2) x.pen[x.setup.pop()!] = 'MR';
        x.setup.push(pid);
      }
      x.pen[pid] = role;
    });

  const save = (auto: boolean) => {
    org.depth[level] = { ...d, auto };
    // A manual MLB chart means you, not the assistant GM, set the lineup.
    if (level === 'MLB') org.agm.depth = auto;
    setDraft(null);
    changed();
  };

  // Change a hitter's position; whoever had that spot takes his old one.
  const setPos = (i: number, pos: Pos) => {
    update((x) => {
      const c = cardOf(x);
      const j = c.findIndex((s, k) => k !== i && s.pos === pos);
      if (j >= 0) c[j].pos = c[i].pos;
      c[i].pos = pos;
    });
    setPosMenu(null);
  };
  const optimize = () => update((x) => {
    const best = suggestLineup(league, org.id, level, vs);
    if (best.length !== 9) return;
    const c = cardOf(x);
    c.splice(0, c.length, ...best.map((b) => ({ pid: b.p.id, pos: b.pos })));
  });

  // Pitching drag: rotation slots reorder; a reliever dropped on a slot takes it
  // (the starter he replaces goes to middle relief).
  const dropRot = (i: number) => {
    if (!drag || (drag.from !== 'rot' && drag.from !== 'pen')) return;
    update((x) => {
      if (drag.from === 'rot') {
        const [m] = x.rotation.splice(drag.i, 1);
        x.rotation.splice(i, 0, m);
      } else {
        const out = x.rotation[i];
        x.rotation[i] = drag.pid;
        if (x.closer === drag.pid) x.closer = out ?? null;
        x.setup = x.setup.filter((id) => id !== drag.pid);
        x.pen ??= {};
        delete x.pen[drag.pid];
        if (out !== undefined && x.closer !== out) x.pen[out] = 'MR';
      }
    });
    setDrag(null);
    setOver(null);
  };

  const dragRow = (from: 'lineup' | 'bench' | 'rot' | 'pen', i: number, pid: number, onDrop?: () => void) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(pid)); setDrag({ from, i, pid }); },
    onDragEnd: () => { setDrag(null); setOver(null); },
    ...(onDrop ? {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (over !== i) setOver(i); },
      onDragLeave: () => setOver((o) => (o === i ? null : o)),
      onDrop: (e: React.DragEvent) => { e.preventDefault(); onDrop(); },
    } : {}),
  });
  const grip = (from: 'lineup' | 'bench' | 'rot' | 'pen', i: number, pid: number, onDrop?: () => void) => (
    <td
      className={`grip${drag?.pid === pid && drag.from === from ? ' picked' : ''}`}
      title="Drag, or tap here and then tap the spot you want"
      onClick={(e) => {
        e.stopPropagation();
        if (drag && onDrop && drag.pid !== pid) onDrop();
        else setDrag(drag?.pid === pid ? null : { from, i, pid });
      }}
    >⋮⋮</td>
  );
  const ovrCell = (p: Player) => { const v = scoutedOvr(league, p); return <td className={`ovr ${gradeClass(v)}`}>{v}</td>; };
  const defCell = (p: Player | undefined, pos: Pos) => {
    if (!p || pos === 'DH' || pos === 'SP' || pos === 'RP') return <td className="muted">-</td>;
    const v = Math.round(defAt(p, pos));
    return <td className={`ovr ${gradeClass(v)}`}>{v}</td>;
  };

  // The header shows whoever you clicked (or the leadoff man / your ace).
  const fallback = tab === 'lineup' ? league.players[cur[0]?.pid] : league.players[d.rotation[0]];
  const shown = (sel !== null ? league.players[sel] : null) ?? fallback ?? null;
  const shownSlot = shown ? cur.find((s) => s.pid === shown.id) : undefined;
  // Who's up next under the saved chart (the manager skips anyone not rested).
  const savedRot = rotationOf(league, org.id, level, pitchers, org.depth[level]);
  const cycle = Math.max(savedRot.length, ...(org.depth[level]?.auto === false ? org.depth[level]!.bullpenDays ?? [] : []).map((x) => x + 1));
  const nextSlot = cycle ? (org.rotationIndex[level] ?? 0) % cycle : -1;
  const nextPid = savedRot[nextSlot]?.id;
  const rotIdx = !dirty && nextPid !== undefined ? d.rotation.indexOf(nextPid) : -1;
  const season0 = season;

  const lineupPanel = (
    <div className="spanel">
      <div className="spanel-head">
        <span>Lineup</span>
        <span>
          <button className={`btn btn-sm${vs === 'R' ? ' active' : ''}`} onClick={() => setVs('R')}>vs RHP</button>{' '}
          <button className={`btn btn-sm${vs === 'L' ? ' active' : ''}`} onClick={() => setVs('L')}>vs LHP</button>{' '}
          <button className="btn btn-sm" title="The manager's best nine and positions against this hand, defense included (no rest days)" onClick={optimize}>Optimize</button>{' '}
          <button
            className="btn btn-sm"
            title="Keep these nine players and positions; reorder them into the best batting order"
            onClick={() => update((x) => {
              const c = cardOf(x);
              const slots = c.map((s) => ({ s, p: league.players[s.pid] })).filter((y) => y.p);
              if (slots.length !== c.length) return;
              c.splice(0, c.length, ...battingOrder(slots, vs).map((y) => y.s));
            })}
          >Sort order</button>
        </span>
      </div>
      <table className="stable lineup-tbl">
        <thead><tr><th /><th className="grip" /><th className="l">Player</th><th>Pos</th><th>B</th><th>Ovr</th><th title="Defense at the position he's playing">Def</th>{HIT_HEAD(vs)}</tr></thead>
        <tbody>
          {cur.map((s, i) => {
            const p = league.players[s.pid];
            const out = p ? outReason(p) : null;
            return (
              <tr key={i} {...dragRow('lineup', i, s.pid, () => drop(i))} onClick={() => setSel(s.pid)}
                className={`${over === i && (drag?.from === 'lineup' || drag?.from === 'bench') ? 'drop-target' : ''}${drag?.from === 'lineup' && drag.i === i ? ' dragging' : ''}${shown?.id === s.pid ? ' sel' : ''}`}>
                <td className="num">{i + 1}.</td>
                {grip('lineup', i, s.pid, () => drop(i))}
                <td className="l nm">{p ? `${p.first} ${p.last}` : '—'}{p && <HeatIcon league={league} p={p} />}{out && <span className="out" title="The manager plays the best available sub here until he's back">{out}</span>}</td>
                <td style={{ position: 'relative' }}>
                  <button className="pos-btn" onClick={(e) => { e.stopPropagation(); setRoleMenu(null); setPosMenu(posMenu === i ? null : i); }}>{s.pos}</button>
                  {posMenu === i && p && (
                    <div className="pos-menu" style={{ right: 0, top: 30 }} onClick={(e) => e.stopPropagation()}>
                      {POSITIONS.map((pos) => {
                        const v = pos === 'DH' ? null : Math.round(defAt(p, pos as Exclude<Pos, 'DH' | 'SP' | 'RP'>));
                        const holder = cur.find((x, k) => k !== i && x.pos === pos);
                        return (
                          <button key={pos} className={`${pos === s.pos ? 'cur ' : ''}${v !== null ? gradeClass(v) : ''}`} onClick={() => setPos(i, pos)} title={holder ? `Swaps with ${league.players[holder.pid]?.last ?? ''}` : ''}>
                            <b>{pos}</b><span>{v ?? '—'}</span>
                          </button>
                        );
                      })}
                      <div className="pm-note">Defense rating at each spot. Picking a taken spot swaps positions with that player.</div>
                    </div>
                  )}
                </td>
                <td>{p?.bats ?? ''}</td>
                {p ? ovrCell(p) : <td />}
                {defCell(p, s.pos)}
                {p ? <HitCells league={league} p={p} level={level} season={season} vs={vs} /> : <td colSpan={5} />}
              </tr>
            );
          })}
        </tbody>
      </table>
      {(dupes.length > 0 || missingPos.length > 0) && (
        <div style={{ padding: 10 }}>
          {dupes.length > 0 && <div className="alert alert-err">A player is listed twice.</div>}
          {missingPos.length > 0 && <div className="alert alert-err">Missing: {missingPos.join(', ')}</div>}
        </div>
      )}
      <p className="help">Drag a hitter to a new spot in the order, or drag a bench player onto a spot to replace him (on a phone, tap ⋮⋮ then tap the spot). Tap a position to move him around the diamond. The vs LHP card starts as a copy of your vs RHP card.</p>
    </div>
  );

  const benchPanel = (
    <div className="spanel">
      <div className="spanel-head"><span>Bench</span></div>
      {bench.length === 0 ? <p className="help">No other hitters.</p> : (
        <div style={{ overflowX: 'auto' }}>
        <table className="stable bench-tbl">
          <thead><tr><th className="grip" /><th className="l">Player</th><th>Pos</th><th>B</th><th>Ovr</th>{HIT_HEAD(vs)}</tr></thead>
          <tbody>
            {bench.map((h) => (
              <tr key={h.id} {...dragRow('bench', -1, h.id)} onClick={() => setSel(h.id)} className={`${drag?.pid === h.id ? 'dragging' : ''}${shown?.id === h.id ? ' sel' : ''}`}>
                {grip('bench', -1, h.id)}
                <td className="l nm">{h.first} {h.last}<HeatIcon league={league} p={h} />{outReason(h) && <span className="out">{outReason(h)}</span>}</td>
                <td>{posLabel(h)}</td>
                <td>{h.bats}</td>
                {ovrCell(h)}
                <HitCells league={league} p={h} level={level} season={season} vs={vs} />
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );

  const rotationPanel = (
    <div className="spanel">
      <div className="spanel-head">
        <span>Starting rotation</span>
        <span className="small" style={{ fontSize: 12, letterSpacing: 0, textTransform: 'none' }}>
          Playoffs:{' '}
          <select value={d.playoffRotation ?? 4} onChange={(e) => update((x) => { x.playoffRotation = Number(e.target.value) as 3 | 4; })} style={{ background: '#0f2240', color: '#fff' }}>
            <option value={4}>4 starters</option><option value={3}>3 starters</option>
          </select>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
      <table className="stable">
        <thead><tr><th /><th className="grip" /><th className="l">Starters</th><th>T</th><th>Ovr</th><th title="Days since his last start (ready at 5)">Rest</th><th className="l">{season0}</th><th /></tr></thead>
        <tbody>
          {d.rotation.map((pid, i) => {
            const bp = (d.bullpenDays ?? []).includes(i);
            const p = league.players[pid];
            const rd = p ? Math.max(0, Math.min(5, restDays(league, p))) : 0;
            const ready = rd >= 5;
            return (
              <tr key={i} {...dragRow('rot', i, pid, () => dropRot(i))} onClick={() => !bp && setSel(pid)}
                className={`${over === i && (drag?.from === 'rot' || drag?.from === 'pen') ? 'drop-target' : ''}${drag?.from === 'rot' && drag.i === i ? ' dragging' : ''}${!bp && shown?.id === pid ? ' sel' : ''}`}>
                <td className="num">{i + 1}.</td>
                {bp ? <td /> : grip('rot', i, pid, () => dropRot(i))}
                <td className="l nm">
                  {bp ? 'Bullpen game' : p ? `${p.first} ${p.last}` : '—'}{!bp && p && <HeatIcon league={league} p={p} />}
                  {i === rotIdx && <span className="tagx next">Next</span>}
                </td>
                <td>{bp ? '' : p?.throws}</td>
                {bp || !p ? <td /> : ovrCell(p)}
                <td>{bp || !p ? '' : <span title={ready ? 'Ready' : `${rd} days since his last start`}><span className="rest"><div style={{ width: `${(rd / 5) * 100}%`, background: ready ? '#2fbf71' : rd >= 3 ? '#f5c542' : '#e5484d' }} /></span></span>}</td>
                <td className="l wrap">{bp || !p ? <span className="muted small">An opener, then the pen</span> : <StarterLine league={league} p={p} level={level} season={season} />}</td>
                <td>
                  <button className="btn btn-sm" title="Make this turn a bullpen game: a rested reliever opens, then the pen covers" onClick={(e) => { e.stopPropagation(); update((x) => { const st = new Set(x.bullpenDays ?? []); if (bp) st.delete(i); else st.add(i); x.bullpenDays = [...st].sort(); }); }}>
                    {bp ? 'Cancel BP game' : 'BP game'}
                  </button>
                </td>
              </tr>
            );
          })}
          {d.rotation.length < 5 && (
            <tr {...dragRow('rot', d.rotation.length, -1, () => dropRot(d.rotation.length))} draggable={false} className={over === d.rotation.length ? 'drop-target' : ''}>
              <td className="num">{d.rotation.length + 1}.</td>
              <td className="grip" onClick={(e) => { e.stopPropagation(); if (drag) dropRot(d.rotation.length); }}>⋮⋮</td>
              <td className="l muted" colSpan={6}>[Open] No fifth starter: these turns are bullpen games. Drag a pitcher here to fill it.</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <p className="help">Drag starters to reorder, or drag a reliever onto a turn to give him the start (the starter he replaces moves to middle relief). A bullpen game: a rested reliever (not your closer) opens for an inning or two, then the pen covers.</p>
    </div>
  );

  const ROLE_ORDER: PenRole[] = ['CL', 'SU', 'MR', 'LR', 'MU'];
  const penPanel = (
    <div className="spanel">
      <div className="spanel-head"><span>Bullpen</span></div>
      <table className="stable">
        <thead><tr><th className="grip" /><th className="l">Relievers</th><th>Role</th><th>T</th><th>Ovr</th><th title="Appearances in the last 7 days">7d</th><th>G</th><th>ERA</th><th>SV/HLD</th></tr></thead>
        <tbody>
          {ROLE_ORDER.flatMap((role) => {
            const group = relievers.filter((p) => roleOf(p.id) === role).sort((a, b) => (role === 'SU' ? d.setup.indexOf(a.id) - d.setup.indexOf(b.id) : scoutedOvr(league, b) - scoutedOvr(league, a)));
            const label = PEN_ROLES.find((r) => r.key === role)!;
            return [
              <tr key={`h-${role}`} className="sub"><td colSpan={9} title={label.help}>{label.label}{role === 'SU' ? ' (up to 2)' : ''} · <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>{label.help}</span></td></tr>,
              ...(group.length ? group.map((p) => {
                const s = seasonPit(p, season, level);
                const recent = (p.recentApps ?? []).filter((x) => x > league.day - 7 && x <= league.day).length;
                return (
                  <tr key={p.id} {...dragRow('pen', -1, p.id)} onClick={() => setSel(p.id)} className={`${drag?.pid === p.id ? 'dragging' : ''}${shown?.id === p.id ? ' sel' : ''}`}>
                    {grip('pen', -1, p.id)}
                    <td className="l nm">{p.first} {p.last}<HeatIcon league={league} p={p} />{p.pos === 'SP' && <span className="tagx">SP</span>}</td>
                    <td style={{ position: 'relative' }}>
                      <button className={`role-btn ${roleOf(p.id)}`} onClick={(e) => { e.stopPropagation(); setPosMenu(null); setRoleMenu(roleMenu === p.id ? null : p.id); }}>
                        {roleOf(p.id) === 'SU' ? `SU${d.setup.indexOf(p.id) + 1}` : roleOf(p.id)}
                      </button>
                      {roleMenu === p.id && (
                        <div className="pos-menu" style={{ right: 0, top: 26, gridTemplateColumns: 'repeat(1, 150px)' }} onClick={(e) => e.stopPropagation()}>
                          {PEN_ROLES.map((r) => (
                            <button key={r.key} className={r.key === roleOf(p.id) ? 'cur' : ''} title={r.help} onClick={() => { setRole(p.id, r.key); setRoleMenu(null); }}>
                              <b>{r.label}</b>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{p.throws}</td>
                    {ovrCell(p)}
                    <td className={recent >= 3 ? 'neg' : ''}>{recent || ''}</td>
                    <td>{s.g || ''}</td>
                    <td>{s.outs ? era(s).toFixed(2) : ''}</td>
                    <td>{s.g ? `${s.sv}/${s.hld}` : ''}</td>
                  </tr>
                );
              }) : [<tr key={`e-${role}`}><td /><td className="l muted" colSpan={8}>[Empty]</td></tr>]),
            ];
          })}
        </tbody>
      </table>
      {d.closer === null && <div style={{ padding: 10 }}><div className="alert alert-err">Pick a closer.</div></div>}
      <p className="help">Tap a role to change it. The manager goes to each role by game situation: setup 1 gets the 8th, setup 2 the 7th.</p>
    </div>
  );

  return (
    <div className="show" onClick={() => { if (posMenu !== null) setPosMenu(null); if (roleMenu !== null) setRoleMenu(null); }}>
      <div className="show-bar">
        <h1 style={{ margin: 0 }}>Depth Chart <span className="muted small">{org.affiliates[level].name}</span></h1>
        {level === 'MLB' && <a className="btn btn-sm" href={href('depth-field')}>Field view</a>}
      </div>
      <LevelTabs value={level} onChange={(v) => go('depth', [], { level: v })} />
      {shown && (
        <ShowHeader league={league} p={shown} level={level}>
          {shownSlot && <span className="sh-chip">Playing {shownSlot.pos}{shownSlot.pos !== 'DH' ? ` · Def ${Math.round(defAt(shown, shownSlot.pos as Exclude<Pos, 'DH' | 'SP' | 'RP'>))}` : ''}</span>}
          {!isPitcher(shown) && (() => { const pg = positionGames(shown, playedSeason(league), level); return pg.length ? <span className="sh-chip" title="Games at each position this season at this level">Played {posGamesText(pg, 4)}</span> : null; })()}
          {!isPitcher(shown) ? null : d.rotation.includes(shown.id) ? <span className="sh-chip">Rotation #{d.rotation.indexOf(shown.id) + 1}</span> : <span className="sh-chip">{PEN_ROLES.find((r) => r.key === roleOf(shown.id))?.label}</span>}
        </ShowHeader>
      )}
      <div className="show-tabs">
        <button className={tab === 'lineup' ? 'on' : ''} onClick={() => { setTab('lineup'); setSel(null); }}>Lineups</button>
        <button className={tab === 'pitching' ? 'on' : ''} onClick={() => { setTab('pitching'); setSel(null); }}>Pitching rotation</button>
        <span style={{ flex: 1 }} />
        <span className="show-bar" style={{ margin: 0 }}>
          <span className={`mode${org.depth[level]?.auto === false ? ' manual' : ''}`}>{org.depth[level]?.auto === false ? 'Manual' : 'Auto: manager sets it daily'}</span>
          <span className="small muted">Stats</span>
          <select value={when} onChange={(e) => { statWhen = e.target.value as StatWhen; setWhen(statWhen); }}>
            <option value="this">{depthSeason(league, 'this')} at {level}</option>
            <option value="last">{depthSeason(league, 'last')} at {level}</option>
          </select>
        </span>
      </div>
      {tab === 'lineup' ? <div className="show-panels">{lineupPanel}{benchPanel}</div> : <div className="show-panels even">{rotationPanel}{penPanel}</div>}
      <div className="show-bar" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" disabled={!valid} onClick={() => save(false)}>Save as manual depth chart</button>
        {org.depth[level]?.auto === false && <button className="btn btn-sm" onClick={() => save(true)}>Switch to auto</button>}
        {dirty && <span className="muted small">Unsaved changes</span>}
        {dirty && <button className="btn btn-sm" onClick={() => setDraft(null)}>Undo changes</button>}
      </div>
      <p className="help" style={{ margin: '6px 0' }}>Your manual lineup is used every day; if someone in it is hurt or off the active roster, only his spot is filled by the best available bench player, and he goes back in when he returns. Auto lineups platoon against the opposing starter and rest regulars now and then.</p>
    </div>
  );
}
