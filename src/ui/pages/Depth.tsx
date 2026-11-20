import { useState } from 'react';
import { useStore, changed } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { DepthChart, Level, Player, Pos } from '../../core/types.ts';
import { activeAt, playersAt } from '../../core/util.ts';
import { isPitcher, posRating, scoutedOvr } from '../../core/ratings.ts';
import { buildLineup } from '../../core/sim/lineup.ts';
import { LevelTabs } from '../components.tsx';
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
    if (saved && !saved.auto) return JSON.parse(JSON.stringify(saved)) as DepthChart;
    if (autoCache?.key !== `${league.id}-${key}`) {
      const lu = buildLineup(league, org.id, level);
      autoCache = {
        key: `${league.id}-${key}`,
        d: {
          auto: saved?.auto ?? true,
          lineup: lu ? lu.batters.map((b) => ({ pid: b.p.id, pos: b.pos })) : [],
          rotation: [],
          closer: lu?.closer?.id ?? null,
          setup: lu?.setup.map((p) => p.id) ?? [],
        },
      };
    }
    return JSON.parse(JSON.stringify(autoCache.d)) as DepthChart;
  };
  const d = draft?.key === key ? draft.d : current();
  const update = (fn: (x: DepthChart) => void) => {
    const x = JSON.parse(JSON.stringify(d)) as DepthChart;
    fn(x);
    setDraft({ key, d: x });
  };
  if (d.rotation.length === 0) {
    d.rotation = [...pitchers].sort((a, b) => (b.pos === 'SP' ? 1 : 0) - (a.pos === 'SP' ? 1 : 0) || scoutedOvr(league, b) - scoutedOvr(league, a)).slice(0, 5).map((p) => p.id);
  }
  while (d.lineup.length < 9) d.lineup.push({ pid: healthyHitters[d.lineup.length]?.id ?? 0, pos: POSITIONS[d.lineup.length] });
  // A player who has since left the level keeps his slot until you replace him.
  for (const s of d.lineup) {
    const p = league.players[s.pid];
    if (p && !hitters.includes(p) && p.orgId === org.id && !isPitcher(p)) hitters.push(p);
  }
  const bench = hitters.filter((h) => !d.lineup.some((s) => s.pid === h.id));

  // Drop onto lineup spot i: a lineup player moves to that spot (with his
  // position); a bench player takes over that spot's position.
  const drop = (i: number) => {
    if (!drag) return;
    update((x) => {
      if (drag.from === 'lineup') {
        const [moved] = x.lineup.splice(drag.i, 1);
        x.lineup.splice(i, 0, moved);
      } else {
        x.lineup[i] = { pid: drag.pid, pos: x.lineup[i].pos };
      }
    });
    setDrag(null);
    setOver(null);
  };

  const name = (p: Player) => `${p.first} ${p.last} (${posLabel(p)}, ${scoutedOvr(league, p)})`;
  const ids = d.lineup.map((s) => s.pid);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const posList = d.lineup.map((s) => s.pos);
  const missingPos = POSITIONS.filter((p) => !posList.includes(p));
  const valid = dupes.length === 0 && missingPos.length === 0 && ids.every((id) => hitters.some((h) => h.id === id));
  const dirty = draft?.key === key;

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
          <p className="muted small">Drag a hitter to a new spot in the order, or drag a bench player onto a spot to replace whoever is there.</p>
          <table className="data compact">
            <thead><tr><th>#</th><th /><th className="l">Player</th><th>Pos</th><th>Def</th></tr></thead>
            <tbody>
              {d.lineup.map((s, i) => {
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
                    className={`draggable${over === i ? ' drop-target' : ''}${drag?.from === 'lineup' && drag.i === i ? ' dragging' : ''}`}
                  >
                    <td>{i + 1}</td>
                    <td className="grip" title="Drag">⋮⋮</td>
                    <td className="l">
                      <select value={s.pid} onChange={(e) => update((x) => { x.lineup[i].pid = Number(e.target.value); })}>
                        {hitters.map((h) => <option key={h.id} value={h.id}>{name(h)}{outReason(h) ? ` [${outReason(h)}]` : ''}</option>)}
                      </select>
                      {out && <span className="tag tag-il" title="The manager plays the best available sub in this spot until he's back">{out}: sub plays</span>}
                    </td>
                    <td>
                      <select value={s.pos} onChange={(e) => update((x) => { x.lineup[i].pos = e.target.value as Pos; })}>
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
                    className={`draggable${drag?.pid === h.id ? ' dragging' : ''}`}
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
              </select>
            </div>
          ))}
          <h3>Bullpen roles</h3>
          <div className="form-row">
            Closer{' '}
            <select value={d.closer ?? ''} onChange={(e) => update((x) => { x.closer = Number(e.target.value); })}>
              {pitchers.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}
            </select>
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="form-row">
              Setup {i + 1}{' '}
              <select value={d.setup[i] ?? ''} onChange={(e) => update((x) => { x.setup[i] = Number(e.target.value); })}>
                <option value="">(auto)</option>
                {pitchers.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}
              </select>
            </div>
          ))}
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
