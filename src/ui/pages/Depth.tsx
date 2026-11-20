import { useState } from 'react';
import type React from 'react';
import { useStore, changed } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { DepthChart, Level, PenRole, Player, Pos } from '../../core/types.ts';
import { PEN_ROLES } from '../../core/types.ts';
import { activeAt, playersAt } from '../../core/util.ts';
import { isPitcher, posRating, scoutedOvr } from '../../core/ratings.ts';
import { buildLineup } from '../../core/sim/lineup.ts';
import { LevelTabs } from '../components.tsx';
import { PlayerCard } from '../PlayerCard.tsx';
import { posLabel } from '../../core/rules.ts';

const POSITIONS: Pos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

// The auto lineup includes random rest days, so build it once per roster state
// rather than on every redraw (otherwise players shuffle while you drag).
let autoCache: { key: string; d: DepthChart } | null = null;

export default function Depth() {
  const { league, version } = useStore();
  const route = useRoute();
  const level = (route.query.level ?? 'MLB') as Level;
  const [draft, setDraft] = useState<{ key: string; d: DepthChart } | null>(null);
  const [drag, setDrag] = useState<{ from: 'lineup' | 'bench'; i: number; pid: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [vs, setVs] = useState<'R' | 'L'>('R');
  // Clicking a row shows the player's ratings; clicks on the dropdowns don't count.
  const pick = (pid: number) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('select, option, a, button')) return;
    setSel(pid);
  };
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const roster = activeAt(league, org.id, level).filter((p) => !p.injury);
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
    d.rotation = [...pitchers].sort((a, b) => (b.pos === 'SP' ? 1 : 0) - (a.pos === 'SP' ? 1 : 0) || scoutedOvr(league, b) - scoutedOvr(league, a)).slice(0, 5).map((p) => p.id);
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
    if (!drag) return;
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

  const name = (p: Player) => `${p.first} ${p.last} (${posLabel(p)}, ${scoutedOvr(league, p)})`;
  const ids = cur.map((s) => s.pid);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const posList = cur.map((s) => s.pos);
  const missingPos = POSITIONS.filter((p) => !posList.includes(p));
  const valid = dupes.length === 0 && missingPos.length === 0 && ids.every((id) => hitters.some((h) => h.id === id)) && d.closer !== null;
  const dirty = draft?.key === key;
  const shown = league.players[sel ?? cur[0]?.pid ?? -1] ?? null;
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

  return (
    <>
      <h1>Depth Chart <span className="muted small">{org.affiliates[level].name}</span></h1>
      <LevelTabs value={level} onChange={(v) => go('depth', [], { level: v })} />
      <p>
        Mode: <b>{org.depth[level]?.auto === false ? 'Manual' : 'Auto (manager sets the lineup each day)'}</b>{' '}
        {org.depth[level]?.auto === false && (
          <button className="btn btn-sm" onClick={() => save(true)}>
            Switch to auto
          </button>
        )}
      </p>
      <p className="muted small">
        Edit any time. Your manual lineup is used every day; if someone in it is hurt or off the active roster, only his spot is filled by the best available bench player at that position, and he goes back in when he returns. Auto lineups platoon against the opposing starter and rest regulars now and then.
      </p>
      <div className="cards">
        <div className="box">
          <h3>Lineup</h3>
          <div className="btn-group tabs">
            <button className={`btn btn-sm${vs === 'R' ? ' active' : ''}`} onClick={() => setVs('R')}>vs RHP</button>
            <button className={`btn btn-sm${vs === 'L' ? ' active' : ''}`} onClick={() => setVs('L')}>vs LHP</button>
          </div>
          <p className="muted small">Drag a hitter to a new spot in the order, or drag a bench player onto a spot to replace whoever is there. Click a player to see his ratings. The vs LHP card is used when the other team starts a lefty; until you change it, it starts as a copy of your vs RHP card.</p>
          <table className="data compact">
            <thead><tr><th>#</th><th /><th className="l">Player</th><th>Pos</th><th>Def</th></tr></thead>
            <tbody>
              {cur.map((s, i) => {
                const p = league.players[s.pid];
                const def = p && s.pos !== 'DH' && s.pos !== 'SP' && s.pos !== 'RP' ? Math.round(posRating(p.ratings.def, s.pos)) : '-';
                const out = p ? outReason(p) : null;
                return (
                  <tr
                    key={i}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(s.pid)); setDrag({ from: 'lineup', i, pid: s.pid }); }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    onDragOver={(e) => { e.preventDefault(); if (over !== i) setOver(i); }}
                    onDragLeave={() => setOver((o) => (o === i ? null : o))}
                    onDrop={(e) => { e.preventDefault(); drop(i); }}
                    onClick={pick(s.pid)}
                    className={`draggable${over === i ? ' drop-target' : ''}${drag?.from === 'lineup' && drag.i === i ? ' dragging' : ''}${shown?.id === s.pid ? ' selected' : ''}`}
                  >
                    <td>{i + 1}</td>
                    <td className="grip" title="Drag">⋮⋮</td>
                    <td className="l">
                      <select value={s.pid} onChange={(e) => update((x) => { cardOf(x)[i].pid = Number(e.target.value); })}>
                        {hitters.map((h) => <option key={h.id} value={h.id}>{name(h)}{outReason(h) ? ` [${outReason(h)}]` : ''}</option>)}
                      </select>
                      {out && <span className="tag tag-il" title="The manager plays the best available sub in this spot until he's back">{out}: sub plays</span>}
                    </td>
                    <td>
                      <select value={s.pos} onChange={(e) => update((x) => { cardOf(x)[i].pos = e.target.value as Pos; })}>
                        {POSITIONS.map((p) => <option key={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>{def}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h3>Bench</h3>
          {bench.length === 0 ? <p className="muted small">No other hitters.</p> : (
            <table className="data compact">
              <tbody>
                {bench.map((h) => (
                  <tr
                    key={h.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(h.id)); setDrag({ from: 'bench', i: -1, pid: h.id }); }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    onClick={pick(h.id)}
                    className={`draggable${drag?.pid === h.id ? ' dragging' : ''}${shown?.id === h.id ? ' selected' : ''}`}
                  >
                    <td className="grip" title="Drag onto a lineup spot">⋮⋮</td>
                    <td className="l">{name(h)} {outReason(h) && <span className="tag tag-il">{outReason(h)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {dupes.length > 0 && <div className="alert alert-err">A player is listed twice.</div>}
          {missingPos.length > 0 && <div className="alert alert-err">Missing: {missingPos.join(', ')}</div>}
        </div>
        <div className="box">
          <h3>Rotation</h3>
          {d.rotation.map((pid, i) => (
            <div key={i} className="form-row">
              {i + 1}.{' '}
              <select value={pid} onChange={(e) => update((x) => { x.rotation[i] = Number(e.target.value); })}>
                {pitchers.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}
              </select>{' '}
              <button className="btn btn-sm" onClick={() => setSel(pid)}>Ratings</button>
            </div>
          ))}
          <h3>Bullpen roles</h3>
          <p className="muted small">The manager goes to each role by game situation. One closer, up to two setup men; setup 1 gets the 8th, setup 2 the 7th.</p>
          <table className="data compact">
            <thead><tr><th className="l">Reliever</th><th className="l">Role</th><th /></tr></thead>
            <tbody>
              {relievers.map((p) => (
                <tr key={p.id} className={shown?.id === p.id ? 'selected' : ''}>
                  <td className="l">{name(p)}</td>
                  <td className="l">
                    <select value={roleOf(p.id)} onChange={(e) => setRole(p.id, e.target.value as PenRole)} title={PEN_ROLES.find((r) => r.key === roleOf(p.id))?.help}>
                      {PEN_ROLES.map((r) => <option key={r.key} value={r.key}>{r.key === 'SU' && d.setup.includes(p.id) ? `Setup ${d.setup.indexOf(p.id) + 1}` : r.label}</option>)}
                    </select>
                  </td>
                  <td><button className="btn btn-sm" onClick={() => setSel(p.id)}>Ratings</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.closer === null && <div className="alert alert-err">Pick a closer.</div>}
          {shown && <div style={{ marginTop: 16 }}><PlayerCard league={league} p={shown} level={level} /></div>}
        </div>
      </div>
      <button className="btn btn-primary" disabled={!valid} onClick={() => save(false)}>
        Save as manual depth chart
      </button>{' '}
      {dirty && <span className="muted small">Unsaved changes</span>}{' '}
      {dirty && <button className="btn btn-sm" onClick={() => setDraft(null)}>Undo changes</button>}
    </>
  );
}
