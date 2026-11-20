// Live game: play your MLB game one batter at a time and manage it.
import { useEffect, useRef, useState } from 'react';
import { useStore, liveChanged, finishLive, setMessage } from '../../store.ts';
import { href, go } from '../../router.ts';
import type { League, Player } from '../../core/types.ts';
import type { LiveSide, LiveState } from '../../core/sim/game.ts';
import { contact, scout, scoutedOvr } from '../../core/ratings.ts';
import { posLabel } from '../../core/rules.ts';
import { avg, era, fmt3, ipStr, obp, seasonBat, seasonPit, slg } from '../fmt.tsx';
import { Rating } from '../components.tsx';

const ROLE_NAMES: Record<string, string> = { CL: 'Closer', SU: 'Setup', MR: 'Middle', LR: 'Long', MU: 'Mop-up' };
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

function LineScore({ league, s }: { league: League; s: LiveState }) {
  const n = Math.max(9, s.sides[0].lineScore.length, s.sides[1].lineScore.length);
  const cols = Array.from({ length: n }, (_, i) => i);
  return (
    <table className="data compact linescore">
      <thead>
        <tr><th className="l" />{cols.map((i) => <th key={i}>{i + 1}</th>)}<th>R</th><th>H</th><th>E</th></tr>
      </thead>
      <tbody>
        {s.sides.map((sd, k) => (
          <tr key={k}>
            <td className="l"><b>{league.orgs[sd.orgId].abbrev}</b></td>
            {cols.map((i) => <td key={i}>{sd.lineScore[i] ?? ''}</td>)}
            <td><b>{sd.runs}</b></td><td>{sd.hits}</td><td>{sd.errors}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Diamond({ bases, outs }: { bases: (Player | null)[]; outs: number }) {
  const b = (i: number) => (bases[i] ? 'base on' : 'base');
  return (
    <div className="diamond-wrap">
      <div className="diamond">
        <div className={`${b(1)} b2`} title={bases[1] ? `${bases[1].first} ${bases[1].last}` : ''} />
        <div className={`${b(2)} b3`} title={bases[2] ? `${bases[2].first} ${bases[2].last}` : ''} />
        <div className={`${b(0)} b1`} title={bases[0] ? `${bases[0].first} ${bases[0].last}` : ''} />
      </div>
      <div className="small">
        {[0, 1, 2].map((i) => <span key={i} className={`out-dot${i < outs ? ' on' : ''}`} />)} {outs} out{outs === 1 ? '' : 's'}
        {bases.some(Boolean) && (
          <div className="muted">
            {bases.map((p, i) => (p ? <div key={i}>{['1B', '2B', '3B'][i]}: {p.last}</div> : null))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Live() {
  const { league, live } = useStore();
  const [auto, setAuto] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stepOnce = () => {
    if (!live || live.engine.done()) return;
    live.engine.step();
    liveChanged();
  };

  useEffect(() => {
    if (!auto || !live) return;
    timer.current = setInterval(() => {
      const s = live.engine.state();
      if (live.engine.done() || s.sides[live.userSide].needPitcher) {
        setAuto(false);
        return;
      }
      live.engine.step();
      liveChanged();
    }, 900);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto, live]);

  if (!league) return null;
  if (!live) {
    return (
      <>
        <h1>Live game</h1>
        <p className="muted">No game in progress. On a day your big league club plays, choose <b>Play today's game live</b> from the Play menu.</p>
      </>
    );
  }
  const eng = live.engine;
  const s = eng.state();
  const me = live.userSide;
  const mine = s.sides[me];
  const theirs = s.sides[1 - me];
  const batting = s.half === me;
  const act = (err: string | null) => {
    setMessage(err);
    liveChanged();
  };
  const sel = (k: string) => pick[k] ?? '';
  const setSel = (k: string, v: string) => setPick({ ...pick, [k]: v });

  const toEndOfHalf = () => {
    const h = s.half;
    const inn = s.inning;
    for (let i = 0; i < 40 && !eng.done(); i++) {
      const cur = eng.state();
      if (cur.half !== h || cur.inning !== inn) break;
      if (cur.sides[me].needPitcher) break;
      eng.step();
    }
    liveChanged();
  };
  const simToEnd = () => {
    eng.setAutoPitching(me, true);
    for (let i = 0; i < 400 && !eng.done(); i++) eng.step();
    liveChanged();
  };

  const batter = s.batter;
  const pitcher = s.pitcher;
  const bSide = s.sides[s.half];
  const pSide = s.sides[1 - s.half];
  const bLine = bSide.order.find((o) => o.p.id === batter.id)?.line;
  const pLine = pSide.pitcher.line;
  const bSeason = seasonBat(batter, league.season, 'MLB');
  const pSeason = seasonPit(pitcher, league.season, 'MLB');
  const split = pitcher.throws === 'L' ? 'vL' : 'vR';
  const sp = pitcher.throws === 'L' ? batter.ratings.vL : batter.ratings.vR;
  const R = (p: Player, k: string, v: number) => <Rating v={scout(league, p, k, v)} />;
  const recent = [...s.log].reverse().slice(0, 40);

  return (
    <>
      <h1>
        {league.orgs[s.sides[0].orgId].region} {league.orgs[s.sides[0].orgId].name} at {league.orgs[s.sides[1].orgId].region} {league.orgs[s.sides[1].orgId].name}
        {live.game.playoff && <span className="muted small"> ({live.game.playoff.round} game {live.game.playoff.game})</span>}
      </h1>
      <div className="cards">
        <div className="box">
          <LineScore league={league} s={s} />
          <div className="form-row" style={{ alignItems: 'center' }}>
            <b>{s.over ? 'Final' : `${s.half === 0 ? 'Top' : 'Bottom'} ${ord(s.inning)}`}</b>
          </div>
          {!s.over && <Diamond bases={s.bases} outs={s.outs} />}
          <div className="form-row">
            {s.over ? (
              <button className="btn btn-primary" onClick={async () => { await finishLive(); go('box', [live.game.id]); }}>Finish game</button>
            ) : (
              <>
                <button className="btn btn-primary" disabled={auto || mine.needPitcher} onClick={stepOnce}>Next batter</button>
                <button className="btn" disabled={auto || mine.needPitcher} onClick={toEndOfHalf}>End of half-inning</button>
                <button className="btn" disabled={mine.needPitcher} onClick={() => setAuto(!auto)}>{auto ? 'Pause' : 'Auto-play'}</button>
                <button className="btn" disabled={auto} onClick={simToEnd} title="Your manager takes over for the rest of the game">Sim to end</button>
              </>
            )}
          </div>
          {mine.needPitcher && <div className="alert alert-err">Your pitcher is hurt. Bring in a reliever to continue.</div>}
        </div>

        {!s.over && (
          <div className="box">
            <h3 style={{ marginTop: 0 }}>At bat</h3>
            <div>
              <a href={href('player', [batter.id])}><b>{batter.first} {batter.last}</b></a> {posLabel(batter)}, bats {batter.bats}
              <div className="small muted">
                Today {bLine ? `${bLine.h}-${bLine.ab}${bLine.hr ? `, ${bLine.hr} HR` : ''}${bLine.bb ? `, ${bLine.bb} BB` : ''}` : '-'} · Season {fmt3(avg(bSeason))}/{fmt3(obp(bSeason))}/{fmt3(slg(bSeason))}, {bSeason.hr} HR
              </div>
              <div className="small">
                vs {pitcher.throws}HP: Hit tool {R(batter, `${split}-contact`, contact(sp))} · Power {R(batter, `${split}-power`, sp.power)} · Eye {R(batter, `${split}-eye`, sp.eye)} · Speed {R(batter, 'spd', batter.ratings.run.speed)}
              </div>
            </div>
            <h3>Pitching</h3>
            <div>
              <a href={href('player', [pitcher.id])}><b>{pitcher.first} {pitcher.last}</b></a> {posLabel(pitcher)}
              {pSide.pitcher.cold && <span className="tag tag-il">Not loose</span>}
              <div className="small muted">
                Today {ipStr(pLine.outs)} IP, {pLine.h} H, {pLine.r} R, {pLine.bb} BB, {pLine.k} K · <b className={pLine.pitches >= 95 ? 'neg' : ''}>{pLine.pitches} pitches</b> · Season {era(pSeason).toFixed(2)} ERA
              </div>
              <div className="small">
                Stuff {R(pitcher, 'stuff', pitcher.ratings.pit.stuff)} · Movement {R(pitcher, 'mov', pitcher.ratings.pit.movement)} · Control {R(pitcher, 'ctl', pitcher.ratings.pit.control)} · Stamina {R(pitcher, 'stam', pitcher.ratings.pit.stamina)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="live-row">
        <div className="box">
          <h3 style={{ marginTop: 0 }}>Play-by-play</h3>
          <div className="pbp">
            {recent.map((e, i) => (
              <div key={s.log.length - i} className={`small${e.scoring ? ' pos' : ''}${e.text.startsWith('Top of') || e.text.startsWith('Bottom of') ? ' pbp-half' : ''}`}>
                {e.text.startsWith('Top of') || e.text.startsWith('Bottom of') ? <b>{e.text}</b> : <>{e.text} <span className="muted">({e.outs} out{e.outs === 1 ? '' : 's'}, {e.away}-{e.home})</span></>}
              </div>
            ))}
            {recent.length === 0 && <p className="muted small">Press Next batter to start.</p>}
          </div>
        </div>
        <LineupCard side={mine} title="Your lineup" me={me} live={live} batting={batting} sel={sel} setSel={setSel} act={act} />
        <LineupCard side={theirs} title={league.orgs[theirs.orgId].name} />

      </div>
      {!s.over && (
        <div className="cards">
          <div className="box">
            <h3 style={{ marginTop: 0 }}>{batting ? 'Your at-bat' : 'In the field'}</h3>
            {batting ? (
              <>
                <div className="form-row">
                  Call for the next pitch:{' '}
                  <button className="btn btn-sm" disabled={!(s.bases[0] || s.bases[1])} onClick={() => act(eng.setTactic(me, { steal: true }))}>Steal</button>
                  <button className="btn btn-sm" disabled={!(s.bases[0] || s.bases[1]) || s.outs >= 2} onClick={() => act(eng.setTactic(me, { bunt: true }))}>Sacrifice bunt</button>
                  <button className="btn btn-sm" disabled={!(s.bases[0] && !s.bases[1]) || s.outs >= 2} onClick={() => act(eng.setTactic(me, { hitRun: true }))}>Hit-and-run</button>
                </div>
                <div className="form-row">
                  Pinch hit for {batter.last}:{' '}
                  <select value={sel('ph')} onChange={(e) => setSel('ph', e.target.value)}>
                    <option value="">Choose…</option>
                    {mine.bench.map((p) => <option key={p.id} value={p.id}>{p.first} {p.last} ({posLabel(p)}, {scoutedOvr(league, p)}, bats {p.bats})</option>)}
                  </select>{' '}
                  <button className="btn btn-sm" disabled={!sel('ph')} onClick={() => { act(eng.pinchHit(me, Number(sel('ph')))); setSel('ph', ''); }}>Pinch hit</button>
                </div>
                {s.bases.map((r, i) =>
                  r ? (
                    <div key={i} className="form-row">
                      Pinch run for {r.last} ({['1B', '2B', '3B'][i]}):{' '}
                      <select value={sel(`pr${i}`)} onChange={(e) => setSel(`pr${i}`, e.target.value)}>
                        <option value="">Choose…</option>
                        {mine.bench.map((p) => <option key={p.id} value={p.id}>{p.first} {p.last} (speed {scout(league, p, 'spd', p.ratings.run.speed)})</option>)}
                      </select>{' '}
                      <button className="btn btn-sm" disabled={!sel(`pr${i}`)} onClick={() => { act(eng.pinchRun(me, i, Number(sel(`pr${i}`)))); setSel(`pr${i}`, ''); }}>Pinch run</button>
                    </div>
                  ) : null,
                )}
              </>
            ) : (
              <>
                <div className="form-row">
                  <button className="btn btn-sm" disabled={mine.visitsLeft <= 0} onClick={() => act(eng.moundVisit(me))}>Mound visit ({mine.visitsLeft} left)</button>
                  <button className="btn btn-sm" disabled={mine.needPitcher} onClick={() => act(eng.intentionalWalk(me))}>Intentional walk</button>
                  <label className="small">
                    <input type="checkbox" checked={mine.infieldIn} onChange={(e) => act(eng.setTactic(me, { infieldIn: e.target.checked }))} /> Infield in
                  </label>
                </div>
                <p className="muted small">A mound visit settles your pitcher for the next two hitters. A second visit in the same inning would remove him. Infield in cuts off the run at third on grounders but lets more balls through.</p>
              </>
            )}
            <div className="form-row">
              <label>
                <input type="checkbox" checked={mine.autoPitching} onChange={(e) => { eng.setAutoPitching(me, e.target.checked); liveChanged(); }} /> Manager makes pitching changes
              </label>
            </div>
          </div>

          <div className="box">
            <h3 style={{ marginTop: 0 }}>Bullpen</h3>
            <table className="data compact">
              <thead><tr><th className="l">Reliever</th><th className="l">Role</th><th className="l">Status</th><th>Ovr</th><th /></tr></thead>
              <tbody>
                {[...mine.bullpen].sort((a, b) => (a.role ? 0 : 1) - (b.role ? 0 : 1)).map((b) => (
                  <tr key={b.p.id}>
                    <td className="l"><a href={href('player', [b.p.id])}>{b.p.first} {b.p.last}</a> <span className="muted small">{b.p.throws}HP</span></td>
                    <td className="l">{b.role ? ROLE_NAMES[b.role] : <span className="muted">Starter</span>}</td>
                    <td className="l small">
                      {b.warm >= 0 ? <span className={b.ready ? 'pos' : ''}>{b.ready ? 'Ready' : `Warming (${b.warm}/3)`}</span> : <span className={b.status === 'Rested' ? '' : 'neg'}>{b.status}</span>}
                    </td>
                    <td><Rating v={scoutedOvr(league, b.p)} /></td>
                    <td className="nowrap">
                      {b.warm >= 0 ? (
                        <button className="btn btn-sm" onClick={() => { eng.sitDown(me, b.p.id); liveChanged(); }}>Sit down</button>
                      ) : (
                        <button className="btn btn-sm" onClick={() => act(eng.warmUp(me, b.p.id))}>Warm up</button>
                      )}{' '}
                      <button className="btn btn-sm" disabled={batting && !mine.needPitcher} title={batting ? 'Bring him in when you take the field' : ''} onClick={() => act(eng.bringIn(me, b.p.id))}>Bring in</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">A reliever needs about three hitters of warming up to be loose; bringing him in cold hurts his first few batters. Getting up and not pitching still counts as work for tomorrow.</p>
          </div>
        </div>
      )}

    </>
  );
}

function LineupCard({ side, title, me, live, batting, sel, setSel, act }: {
  side: LiveSide;
  title: string;
  me?: 0 | 1;
  live?: { engine: { defensiveSub: (s: 0 | 1, slot: number, pid: number) => string | null; switchPositions: (s: 0 | 1, a: number, b: number) => string | null } };
  batting?: boolean;
  sel?: (k: string) => string;
  setSel?: (k: string, v: string) => void;
  act?: (e: string | null) => void;
}) {
  const editable = me !== undefined && live && sel && setSel && act;
  return (
    <div className="box">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <table className="data compact">
        <tbody>
          {side.order.map((o, i) => (
            <tr key={i} className={i === side.next ? 'selected' : ''}>
              <td>{i + 1}</td>
              <td className="l"><a href={href('player', [o.p.id])}>{o.p.last}</a></td>
              <td>{o.pos}</td>
              <td className="small">{o.line.h}-{o.line.ab}{o.line.bb ? `, ${o.line.bb} BB` : ''}{o.line.hr ? `, ${o.line.hr} HR` : ''}</td>
            </tr>
          ))}
          <tr><td /><td className="l">{side.pitcher.p.last}</td><td>P</td><td className="small">{side.pitcher.line.pitches} pitches</td></tr>
        </tbody>
      </table>
      <div className="small">
        Bullpen:{' '}
        {side.bullpen.filter((b) => b.warm >= 0).length
          ? side.bullpen.filter((b) => b.warm >= 0).map((b) => `${b.p.last} ${b.ready ? '(ready)' : '(warming)'}`).join(', ')
          : <span className="muted">quiet</span>}
      </div>
      {editable && (
        <>
          <div className="form-row small">
            Replace{' '}
            <select value={sel('dsSlot')} onChange={(e) => setSel('dsSlot', e.target.value)}>
              <option value="">…</option>
              {side.order.map((o, i) => <option key={i} value={i}>{o.p.last} ({o.pos})</option>)}
            </select>{' '}
            with{' '}
            <select value={sel('dsPid')} onChange={(e) => setSel('dsPid', e.target.value)}>
              <option value="">…</option>
              {side.bench.map((p) => <option key={p.id} value={p.id}>{p.last} ({posLabel(p)})</option>)}
            </select>{' '}
            <button className="btn btn-sm" disabled={!sel('dsSlot') || !sel('dsPid')} onClick={() => { act(live.engine.defensiveSub(me, Number(sel('dsSlot')), Number(sel('dsPid')))); setSel('dsPid', ''); }}>Sub</button>
          </div>
          <div className="form-row small">
            Switch positions{' '}
            <select value={sel('swA')} onChange={(e) => setSel('swA', e.target.value)}>
              <option value="">…</option>
              {side.order.map((o, i) => <option key={i} value={i}>{o.p.last} ({o.pos})</option>)}
            </select>{' '}
            and{' '}
            <select value={sel('swB')} onChange={(e) => setSel('swB', e.target.value)}>
              <option value="">…</option>
              {side.order.map((o, i) => <option key={i} value={i}>{o.p.last} ({o.pos})</option>)}
            </select>{' '}
            <button className="btn btn-sm" disabled={!sel('swA') || !sel('swB') || sel('swA') === sel('swB')} onClick={() => act(live.engine.switchPositions(me, Number(sel('swA')), Number(sel('swB'))))}>Switch</button>
          </div>
          <p className="muted small">{batting ? 'Subs made now take the field next half-inning.' : 'Defensive changes take effect right away.'} Bench: {side.bench.length ? side.bench.map((p) => p.last).join(', ') : 'empty'}. No double switches: with the universal DH, pitchers never bat.</p>
        </>
      )}
    </div>
  );
}
