import { useStore, changed } from '../../store.ts';
import { href, useRoute } from '../../router.ts';
import type { BatSplit, DefRatings, FieldPos, League, Player, StatEntry } from '../../core/types.ts';
import { FIELD_POS } from '../../core/types.ts';
import { contact, isPitcher, posRating, scout, scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { fmtMoney, serviceClass, serviceLabel } from '../../core/contracts.ts';
import { posLabel, optionYearAvailable } from '../../core/rules.ts';
import { orgById, pname } from '../../core/util.ts';
import { dayShort } from '../../core/settings.ts';
import { ActionSelect, OrgLink, Rating, StatusTags } from '../components.tsx';
import { avg, era, fip, fmt3, ipStr, obp, slg, whip } from '../fmt.tsx';
import { entryWar } from '../../core/war.ts';
import { scoutArea } from '../../core/ratings.ts';
import { playerTradeBlock } from '../../core/trade.ts';

function R({ league, p, k, v, pot }: { league: League; p: Player; k: string; v: number; pot?: boolean }) {
  return <Rating v={scout(league, p, k, v, pot)} />;
}

function BatRatings({ league, p }: { league: League; p: Player }) {
  const rows: [string, keyof BatSplit | 'contact'][] = [
    ['Contact', 'contact'],
    ['BABIP', 'babip'],
    ['Avoid K', 'avoidK'],
    ['Gap', 'gap'],
    ['Power', 'power'],
    ['Eye', 'eye'],
  ];
  const val = (s: BatSplit, k: keyof BatSplit | 'contact') => (k === 'contact' ? contact(s) : s[k]);
  return (
    <table className="data compact">
      <thead>
        <tr><th className="l">Batting</th><th>vL</th><th>vR</th><th>Pot</th></tr>
      </thead>
      <tbody>
        {rows.map(([label, k]) => (
          <tr key={k}>
            <td className="l">{label}</td>
            <td><R league={league} p={p} k={`vL-${k}`} v={val(p.ratings.vL, k)} /></td>
            <td><R league={league} p={p} k={`vR-${k}`} v={val(p.ratings.vR, k)} /></td>
            <td><R league={league} p={p} k={`pot-${k}`} v={val(p.pot.bat, k)} pot /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DefTable({ league, p }: { league: League; p: Player }) {
  const d = p.ratings.def;
  const comps: [string, keyof DefRatings][] = [
    ['C Ability', 'cAbil'], ['C Arm', 'cArm'], ['IF Range', 'ifRange'], ['IF Error', 'ifErr'], ['IF Arm', 'ifArm'], ['Turn DP', 'tdp'], ['OF Range', 'ofRange'], ['OF Error', 'ofErr'], ['OF Arm', 'ofArm'],
  ];
  return (
    <div className="cards">
      <table className="data compact">
        <thead><tr><th className="l">Defense</th><th /></tr></thead>
        <tbody>
          {comps.map(([label, k]) => (
            <tr key={k}><td className="l">{label}</td><td><R league={league} p={p} k={`def-${k}`} v={d[k]} /></td></tr>
          ))}
        </tbody>
      </table>
      <table className="data compact">
        <thead><tr><th className="l">Position</th><th>Rating</th></tr></thead>
        <tbody>
          {FIELD_POS.map((pos: FieldPos) => (
            <tr key={pos}><td className="l">{pos}</td><td><R league={league} p={p} k={`pos-${pos}`} v={posRating(d, pos)} /></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PitchTable({ league, p }: { league: League; p: Player }) {
  const r = p.ratings.pit;
  return (
    <div className="cards">
      <table className="data compact">
        <thead><tr><th className="l">Pitching</th><th>Now</th><th>Pot</th></tr></thead>
        <tbody>
          <tr><td className="l">Stuff</td><td><R league={league} p={p} k="stuff" v={r.stuff} /></td><td><R league={league} p={p} k="pstuff" v={p.pot.stuff} pot /></td></tr>
          <tr><td className="l">Movement</td><td><R league={league} p={p} k="mov" v={r.movement} /></td><td><R league={league} p={p} k="pmov" v={p.pot.movement} pot /></td></tr>
          <tr><td className="l">Control</td><td><R league={league} p={p} k="ctl" v={r.control} /></td><td><R league={league} p={p} k="pctl" v={p.pot.control} pot /></td></tr>
          <tr><td className="l">Stamina</td><td><R league={league} p={p} k="stam" v={r.stamina} /></td><td><R league={league} p={p} k="pstam" v={p.pot.stamina} pot /></td></tr>
          <tr><td className="l">Groundball</td><td><R league={league} p={p} k="gb" v={r.gb} /></td><td /></tr>
        </tbody>
      </table>
      <table className="data compact">
        <thead><tr><th className="l">Pitch</th><th>Grade</th></tr></thead>
        <tbody>
          {Object.entries(r.pitches).map(([pt, v]) => (
            <tr key={pt}><td className="l">{PITCH_NAMES[pt] ?? pt}</td><td><R league={league} p={p} k={`pitch-${pt}`} v={v ?? 20} /></td></tr>
          ))}
          <tr><td className="l">Velocity</td><td>{Math.round(r.velo - 1)}-{Math.round(r.velo + 1)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

const PITCH_NAMES: Record<string, string> = { FB: 'Fastball', SI: 'Sinker', CT: 'Cutter', SL: 'Slider', SW: 'Sweeper', CB: 'Curveball', CH: 'Changeup', SP: 'Splitter', KN: 'Knuckleball' };

function personalityWord(v: number): string {
  return v >= 68 ? 'Very high' : v >= 57 ? 'High' : v >= 43 ? 'Normal' : v >= 32 ? 'Low' : 'Very low';
}

function BatStatsTable({ league, p, entries }: { league: League; p: Player; entries: StatEntry[] }) {
  const rows = entries.filter((e) => e.bat.pa > 0);
  if (!rows.length) return <p className="muted">No batting stats.</p>;
  return (
    <div className="table-wrap">
      <table className="data compact">
        <thead>
          <tr><th className="l">Year</th><th className="l">Team</th><th>Lvl</th><th>G</th><th>PA</th><th>AB</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>R</th><th>RBI</th><th>BB</th><th>K</th><th>SB</th><th>CS</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th><th title="Wins above replacement (MLB only)">WAR</th></tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const b = e.bat;
            return (
              <tr key={i}>
                <td className="l">{e.season}</td>
                <td className="l"><OrgLink league={league} orgId={e.orgId} level={e.level} /></td>
                <td>{e.level}</td><td>{b.g}</td><td>{b.pa}</td><td>{b.ab}</td><td>{b.h}</td><td>{b.d}</td><td>{b.t}</td><td>{b.hr}</td><td>{b.r}</td><td>{b.rbi}</td><td>{b.bb}</td><td>{b.k}</td><td>{b.sb}</td><td>{b.cs}</td>
                <td>{fmt3(avg(b))}</td><td>{fmt3(obp(b))}</td><td>{fmt3(slg(b))}</td><td>{fmt3(obp(b) + slg(b))}</td>
                <td>{e.level === 'MLB' ? entryWar(league, p, e).toFixed(1) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PitStatsTable({ league, p, entries }: { league: League; p: Player; entries: StatEntry[] }) {
  const rows = entries.filter((e) => e.pit.bf > 0);
  if (!rows.length) return <p className="muted">No pitching stats.</p>;
  return (
    <div className="table-wrap">
      <table className="data compact">
        <thead>
          <tr><th className="l">Year</th><th className="l">Team</th><th>Lvl</th><th>W</th><th>L</th><th>ERA</th><th>G</th><th>GS</th><th>SV</th><th>HLD</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>HR</th><th>BB</th><th>K</th><th>WHIP</th><th>FIP</th><th>K/9</th><th>P/GS</th><th title="Wins above replacement (MLB only)">WAR</th></tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const s = e.pit;
            return (
              <tr key={i}>
                <td className="l">{e.season}</td>
                <td className="l"><OrgLink league={league} orgId={e.orgId} level={e.level} /></td>
                <td>{e.level}</td><td>{s.w}</td><td>{s.l}</td><td>{era(s).toFixed(2)}</td><td>{s.g}</td><td>{s.gs}</td><td>{s.sv}</td><td>{s.hld}</td><td>{ipStr(s.outs)}</td><td>{s.h}</td><td>{s.r}</td><td>{s.er}</td><td>{s.hr}</td><td>{s.bb}</td><td>{s.k}</td>
                <td>{whip(s).toFixed(2)}</td><td>{fip(s).toFixed(2)}</td><td>{s.outs ? ((s.k * 27) / s.outs).toFixed(1) : '-'}</td><td>{s.gs ? Math.round(s.pitches / Math.max(1, s.gs)) : '-'}</td>
                <td>{e.level === 'MLB' ? entryWar(league, p, e).toFixed(1) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PlayerPage() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const p = league.players[Number(route.args[0])];
  if (!p) return <p>Player not found.</p>;
  const s = league.settings;
  const org = orgById(league, p.orgId);
  const a = league.season - p.born;
  const optLeft = Math.max(0, s.optionYears - p.optionsUsed);
  const txs = league.transactions.filter((t) => t.pids.includes(p.id)).slice(-25).reverse();
  const pers = p.personality;
  const ft = Math.floor(p.height / 12);
  const inch = p.height % 12;

  return (
    <>
      <h1>
        {pname(p)} <StatusTags league={league} p={p} />
      </h1>
      <div className="cards">
        <div className="box">
          <div className="kv">
            <div>Position</div><div>{posLabel(p)}{isPitcher(p) ? '' : ` (bats ${p.bats})`}, throws {p.throws}</div>
            <div>Team</div><div>{org ? <><OrgLink league={league} orgId={org.id} level={p.level ?? 'MLB'} /> ({p.level})</> : 'Free agent'}</div>
            <div>Age</div><div>{a} (born {p.born}, {p.country})</div>
            <div>Height / weight</div><div>{ft}'{inch}", {p.weight} lbs</div>
            <div>Overall / Potential</div><div><Rating v={scoutedOvr(league, p)} /> / <Rating v={scoutedPot(league, p)} /></div>
            <div>Injury</div><div>{p.injury ? `${p.injury.name}, ${p.injury.daysLeft} days` : 'Healthy'}</div>
          </div>
          {p.orgId === league.userOrgId && (
            <div className="form-row">
              <ActionSelect league={league} p={p} />{' '}
              {!playerTradeBlock(league, p) && (
                <button className="btn btn-sm" onClick={() => { const o = league.orgs[league.userOrgId]; o.block = o.block.includes(p.id) ? o.block.filter((x) => x !== p.id) : [...o.block, p.id]; changed(); }}>
                  {league.orgs[league.userOrgId].block.includes(p.id) ? 'Remove from trading block' : 'Put on trading block'}
                </button>
              )}
            </div>
          )}
          {p.orgId !== league.userOrgId && !p.retired && (
            <div className="form-row">
              <button className="btn btn-sm" onClick={() => { const o = league.orgs[league.userOrgId]; o.interest.pids = o.interest.pids.includes(p.id) ? o.interest.pids.filter((x) => x !== p.id) : [...o.interest.pids, p.id]; changed(); }}>
                {league.orgs[league.userOrgId].interest.pids.includes(p.id) ? 'Stop watching' : 'Watch'}
              </button>{' '}
              {p.orgId !== null && !playerTradeBlock(league, p) && <a className="btn btn-sm" href={href('trade', [], { org: p.orgId, pid: p.id })}>Trade for him</a>}
              {org && org.block.includes(p.id) && <span className="tag">On the block</span>}
            </div>
          )}
        </div>
        <div className="box">
          <div className="kv">
            <div>Contract</div>
            <div>
              {p.contract.type === 'ML'
                ? `${fmtMoney(p.contract.salary)}/yr through ${p.contract.exp} (${p.contract.oneWay ? 'one-way' : `split, ${fmtMoney(p.contract.minorSalary)} in minors`})`
                : `Minor league deal (${fmtMoney(p.contract.salary)})`}
            </div>
            {p.contract.option && (
              <>
                <div>{p.contract.option.type === 'club' ? 'Club' : 'Player'} option</div>
                <div>{p.contract.option.season}: {fmtMoney(p.contract.option.salary)}{p.contract.option.buyout ? ` (${fmtMoney(p.contract.option.buyout)} buyout)` : ''}</div>
              </>
            )}
            {p.arb && (
              <>
                <div>Arbitration</div>
                <div>{p.arb.settled !== null ? `${p.arb.result}: ${fmtMoney(p.arb.settled)}` : `Projected ${fmtMoney(p.arb.projected)}`}</div>
              </>
            )}
            {p.rule5 && (
              <>
                <div>Rule 5</div>
                <div>Selected from the {orgById(league, p.rule5.fromOrg)?.affiliates.MLB.name}; must stay on the MLB roster in {p.rule5.season}</div>
              </>
            )}
            {p.fa && p.orgId === null && (
              <>
                <div>Free agent</div>
                <div>Asking {p.fa.asking.years} yr × {fmtMoney(p.fa.asking.aav)}; {p.fa.offers.length} offer{p.fa.offers.length === 1 ? '' : 's'}{p.fa.qo ? '; declined a qualifying offer' : ''} · <a href={href('free-agents')}>make an offer</a></div>
              </>
            )}
            {p.draft && (
              <>
                <div>Drafted</div>
                <div>{p.draft.year}, round {p.draft.round} (#{p.draft.pick}) by {orgById(league, p.draft.orgId)?.abbrev}{p.contract.bonus ? `, ${fmtMoney(p.contract.bonus)} bonus` : ''}</div>
              </>
            )}
            <div>40-man roster</div><div>{p.on40 ? 'Yes' : 'No'}</div>
            <div>MLB service</div><div>{serviceLabel(p.mlServiceDays, s)} ({serviceClass(p, s)}), {p.serviceThisSeason} days this season</div>
            <div>Option years</div>
            <div>
              {p.optionsUsed} used, {optLeft} left{!optionYearAvailable(league, p) ? ' (out of options)' : ''}; {p.optionDaysThisSeason} days optioned this season{p.optionDaysThisSeason >= s.optionDaysToUseYear ? ' (year charged)' : ''}; optioned {p.optionsThisSeason}x
            </div>
            <div>Pro seasons</div><div>{p.proSeasons}</div>
            <div>Outrighted before</div><div>{p.outrightedBefore ? 'Yes' : 'No'}</div>
          </div>
        </div>
        <div className="box">
          <table className="data compact">
            <thead><tr><th className="l">Personality</th><th className="l" /></tr></thead>
            <tbody>
              <tr><td className="l">Work ethic</td><td className="l">{personalityWord(pers.workEthic)}</td></tr>
              <tr><td className="l">Intelligence</td><td className="l">{personalityWord(pers.intelligence)}</td></tr>
              <tr><td className="l">Leadership</td><td className="l">{personalityWord(pers.leadership)}</td></tr>
              <tr><td className="l">Loyalty</td><td className="l">{personalityWord(pers.loyalty)}</td></tr>
              <tr><td className="l">Greed</td><td className="l">{personalityWord(pers.greed)}</td></tr>
              <tr><td className="l">Desire to win</td><td className="l">{personalityWord(pers.winning)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2>Ratings</h2>
      <p className="muted small">Scouted values on the 20-80 scale, from your {({ own: 'scouting director and coaches', pro: 'pro scout', amateur: 'amateur scout', intl: 'international scout' } as const)[scoutArea(league, p)]}. Lower levels and other organizations' players are harder to scout; better scouts see more clearly (Staff page).</p>
      <div className="ratings">
        {isPitcher(p) ? <PitchTable league={league} p={p} /> : <BatRatings league={league} p={p} />}
        {!isPitcher(p) && (
          <table className="data compact">
            <thead><tr><th className="l">Running</th><th /></tr></thead>
            <tbody>
              <tr><td className="l">Speed</td><td><R league={league} p={p} k="spd" v={p.ratings.run.speed} /></td></tr>
              <tr><td className="l">Stealing</td><td><R league={league} p={p} k="stl" v={p.ratings.run.steal} /></td></tr>
              <tr><td className="l">Baserunning</td><td><R league={league} p={p} k="br" v={p.ratings.run.baserunning} /></td></tr>
            </tbody>
          </table>
        )}
        {!isPitcher(p) && <DefTable league={league} p={p} />}
      </div>

      <h2>{isPitcher(p) ? 'Pitching' : 'Batting'} stats</h2>
      {isPitcher(p) ? <PitStatsTable league={league} p={p} entries={p.stats} /> : <BatStatsTable league={league} p={p} entries={p.stats} />}

      <h2>Transactions</h2>
      {txs.length === 0 && <p className="muted">None.</p>}
      {txs.map((t) => (
        <div key={t.id} className="news-item small">
          <span className="muted">{dayShort(t.season, t.day)}</span> {t.text}{' '}
          {t.orgId !== null && <a href={href('roster', [], { org: t.orgId })} className="muted">({orgById(league, t.orgId)?.abbrev})</a>}
        </div>
      ))}
    </>
  );
}
