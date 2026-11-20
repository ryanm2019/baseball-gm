import { useState } from 'react';
import { useStore, changed } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { DepthChart, Level, Player, Pos } from '../../core/types.ts';
import { activeAt } from '../../core/util.ts';
import { isPitcher, posRating, scoutedOvr } from '../../core/ratings.ts';
import { buildLineup } from '../../core/sim/lineup.ts';
import { LevelTabs } from '../components.tsx';
import { posLabel } from '../../core/rules.ts';

const POSITIONS: Pos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

export default function Depth() {
  const { league, version } = useStore();
  const route = useRoute();
  const level = (route.query.level ?? 'MLB') as Level;
  const [draft, setDraft] = useState<{ key: string; d: DepthChart } | null>(null);
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const roster = activeAt(league, org.id, level).filter((p) => !p.injury);
  const hitters = roster.filter((p) => !isPitcher(p));
  const pitchers = roster.filter(isPitcher);
  const key = `${level}-${version}`;

  const current = (): DepthChart => {
    const saved = org.depth[level];
    if (saved && !saved.auto) return JSON.parse(JSON.stringify(saved)) as DepthChart;
    const lu = buildLineup(league, org.id, level);
    return {
      auto: saved?.auto ?? true,
      lineup: lu ? lu.batters.map((b) => ({ pid: b.p.id, pos: b.pos })) : [],
      rotation: [],
      closer: lu?.closer?.id ?? null,
      setup: lu?.setup.map((p) => p.id) ?? [],
    };
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
  while (d.lineup.length < 9) d.lineup.push({ pid: hitters[d.lineup.length]?.id ?? 0, pos: POSITIONS[d.lineup.length] });

  const name = (p: Player) => `${p.first} ${p.last} (${posLabel(p)}, ${scoutedOvr(league, p)})`;
  const ids = d.lineup.map((s) => s.pid);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const posList = d.lineup.map((s) => s.pos);
  const missingPos = POSITIONS.filter((p) => !posList.includes(p));
  const valid = dupes.length === 0 && missingPos.length === 0 && ids.every((id) => hitters.some((h) => h.id === id));

  const save = (auto: boolean) => {
    org.depth[level] = { ...d, auto };
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
        Manual lineups are used whenever all nine players are healthy and on the active roster; otherwise the manager fills in for the day. Auto lineups platoon against the opposing starter and rest regulars now and then.
      </p>
      <div className="cards">
        <div className="box">
          <h3>Lineup</h3>
          <table className="data compact">
            <thead><tr><th>#</th><th className="l">Player</th><th>Pos</th><th>Def</th></tr></thead>
            <tbody>
              {d.lineup.map((s, i) => {
                const p = league.players[s.pid];
                const def = p && s.pos !== 'DH' && s.pos !== 'SP' && s.pos !== 'RP' ? Math.round(posRating(p.ratings.def, s.pos)) : '-';
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="l">
                      <select value={s.pid} onChange={(e) => update((x) => { x.lineup[i].pid = Number(e.target.value); })}>
                        {hitters.map((h) => <option key={h.id} value={h.id}>{name(h)}</option>)}
                      </select>
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
      </button>
    </>
  );
}
