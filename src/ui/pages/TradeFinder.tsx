// Trade Finder: get a player, shop one of yours, or fill a need.
import { useState } from 'react';
import { NumInput } from '../components.tsx';
import { useStore, setMessage } from '../../store.ts';
import { go, href } from '../../router.ts';
import type { League, Player, Pos } from '../../core/types.ts';
import { fillNeed, findPackagesFor, shopPlayer, type FinderOpts, type FoundDeal, type NeedRow, type Want } from '../../core/tradeFinder.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { posLabel } from '../../core/rules.ts';
import { contractInfo, fmtMoney } from '../../core/contracts.ts';
import { orgPlayers } from '../../core/util.ts';
import { tradeWindowOpen } from '../../core/trade.ts';
import { loadTrade } from './Trade.tsx';
import { seasonSummary } from '../tradeCols.tsx';
import { ContractCell } from '../fmt.tsx';

type Mode = 'get' | 'shop' | 'need';
const NEEDS: (Pos | 'OF' | 'LHP')[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH', 'SP', 'RP', 'LHP'];

// Name with position, age, ovr/pot and this season's key number; hover for the
// line at each level and the contract.
function PName({ league, p }: { league: League; p: Player }) {
  const s = seasonSummary(league, p);
  const c = contractInfo(league, p);
  const tip = `${c.text}${c.faAfter !== null ? ` (FA after ${c.faAfter})` : ''}${s ? `\n${s.tip}` : ''}`;
  return (
    <span className="nowrap" title={tip}>
      <a href={href('player', [p.id])}>{p.first[0]}. {p.last}</a> <span className="muted small">{posLabel(p)} {league.season - p.born}y {scoutedOvr(league, p)}/{scoutedPot(league, p)}{p.level !== 'MLB' ? ` ${p.level}` : ''}{s ? (s.wrc !== null ? ` · wRC+ ${s.wrc}` : ` · FIP- ${s.fipm}`) : ''}</span>
    </span>
  );
}

function Assets({ league, side, d }: { league: League; side: 0 | 1; d: FoundDeal }) {
  const g = d.prop.give[side];
  return (
    <span>
      {g.pids.map((id, i) => <span key={id}>{i > 0 && ', '}<PName league={league} p={league.players[id]} /></span>)}
      {g.cbPicks.length > 0 && <span>{g.pids.length ? ', ' : ''}{g.cbPicks.length} competitive balance pick{g.cbPicks.length > 1 ? 's' : ''}</span>}
      {g.pool > 0 && <span>{g.pids.length || g.cbPicks.length ? ', ' : ''}{fmtMoney(g.pool)} international pool</span>}
    </span>
  );
}

export default function TradeFinder() {
  const { league } = useStore();
  const [mode, setMode] = useState<Mode>('get');
  const [target, setTarget] = useState('');
  const [mine, setMine] = useState<number | ''>('');
  const [want, setWant] = useState<Want>('best');
  const [need, setNeed] = useState<Pos | 'OF' | 'LHP'>('CF');
  const [kind, setKind] = useState<FinderOpts['kind']>('any');
  const [allowPicks, setAllowPicks] = useState(true);
  const [maxSal, setMaxSal] = useState(40);
  const [mlbOnly, setMlbOnly] = useState(true);
  const [untouch, setUntouch] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deals, setDeals] = useState<FoundDeal[] | null>(null);
  const [rows, setRows] = useState<NeedRow[] | null>(null);
  if (!league) return null;
  const user = league.orgs[league.userOrgId];
  const myPlayers = orgPlayers(league, user.id).filter((p) => p.on40 || p.level === 'MLB' || scoutedPot(league, p) >= 50).sort((a, b) => scoutedOvr(league, b) - scoutedOvr(league, a));
  const others = Object.values(league.players).filter((p) => p.orgId !== null && p.orgId !== user.id && (p.level === 'MLB' || p.on40 || p.level === 'AAA'));
  const matches = target.length >= 2 ? others.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(target.toLowerCase())).slice(0, 12) : [];
  const opts = (): FinderOpts => ({ untouchable: untouch, allowPicks, kind });
  const closed = tradeWindowOpen(league);

  const run = (f: () => void) => { setBusy(true); setDeals(null); setRows(null); setTimeout(() => { try { f(); } finally { setBusy(false); } }, 20); };
  const open = (d: FoundDeal) => { loadTrade(d.prop.orgs[1], [d.prop.give[0], d.prop.give[1]]); go('trade'); };
  const dealTable = (ds: FoundDeal[], shop: boolean) => (
    <table className="data compact">
      <thead><tr><th className="l">Team</th><th className="l">You give</th><th className="l">You get</th><th title="Your front office's valuation">Value to you</th><th /></tr></thead>
      <tbody>
        {ds.map((d, i) => {
          const o = league.orgs[d.prop.orgs[1]];
          return (
            <tr key={i}>
              <td className="l">{o.abbrev}{shop ? <span className="muted small"> {o.stance}</span> : <span className="muted small"> {d.note}</span>}</td>
              <td className="l"><Assets league={league} side={0} d={d} /></td>
              <td className="l"><Assets league={league} side={1} d={d} /></td>
              <td className={d.valueToYou >= d.costToYou ? 'pos' : 'neg'}>{fmtMoney(d.valueToYou - d.costToYou)}</td>
              <td><button className="btn btn-sm" onClick={() => open(d)}>Open in Trade</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <>
      <h1>Trade Finder</h1>
      {closed && <div className="alert alert-warn small">{closed}. You can still search; trades can be made when the window reopens.</div>}
      <div className="btn-group tabs">
        {(['get', 'shop', 'need'] as Mode[]).map((m) => (
          <button key={m} className={`btn btn-sm${mode === m ? ' active' : ''}`} onClick={() => { setMode(m); setDeals(null); setRows(null); }}>
            {m === 'get' ? 'Get a player' : m === 'shop' ? 'Shop my player' : 'Fill a need'}
          </button>
        ))}
      </div>

      {mode !== 'shop' && (
        <div className="form-row small">
          Give:{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value as FinderOpts['kind'])}>
            <option value="any">Anyone</option><option value="prospects">Prospects only</option><option value="mlb">MLB players only</option>
          </select>{' '}
          <label><input type="checkbox" checked={allowPicks} onChange={(e) => setAllowPicks(e.target.checked)} /> Include competitive balance picks and pool money</label>{' '}
          <details style={{ display: 'inline-block' }}>
            <summary>Untouchables ({untouch.size})</summary>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {myPlayers.slice(0, 60).map((p) => (
                <label key={p.id} style={{ display: 'block' }}>
                  <input type="checkbox" checked={untouch.has(p.id)} onChange={(e) => { const s = new Set(untouch); if (e.target.checked) s.add(p.id); else s.delete(p.id); setUntouch(s); }} /> <PName league={league} p={p} />
                </label>
              ))}
            </div>
          </details>
        </div>
      )}

      {mode === 'get' && (
        <>
          <div className="form-row">
            <input placeholder="Search any player in the league…" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 280 }} />
          </div>
          {matches.length > 0 && (
            <div className="small">
              {matches.map((p) => (
                <div key={p.id}>
                  <button className="btn btn-sm" disabled={busy} onClick={() => run(() => { const ds = findPackagesFor(league, p.id, opts()); setDeals(ds); if (!ds.length) setMessage(`No package from your organization works for ${p.first} ${p.last} with these settings.`); })}>Find packages</button>{' '}
                  <PName league={league} p={p} /> <span className="muted">({league.orgs[p.orgId!].abbrev}, {fmtMoney(p.contract.salary)})</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === 'shop' && (
        <div className="form-row">
          <select value={mine} onChange={(e) => setMine(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Choose one of your players…</option>
            {myPlayers.map((p) => <option key={p.id} value={p.id}>{posLabel(p)} {p.first} {p.last} ({scoutedOvr(league, p)}/{scoutedPot(league, p)}{p.level !== 'MLB' ? `, ${p.level}` : ''})</option>)}
          </select>{' '}
          What you want back:{' '}
          <select value={want} onChange={(e) => setWant(e.target.value as Want)}>
            <option value="best">Best offer</option><option value="prospects">Prospects</option><option value="mlb">MLB talent</option><option value="picks">Picks and pool money</option>
          </select>{' '}
          <button className="btn btn-primary btn-sm" disabled={mine === '' || busy} onClick={() => run(() => { const ds = shopPlayer(league, Number(mine), want); setDeals(ds); if (!ds.length) setMessage(want === 'picks' ? 'No offers in picks or pool money. Only clubs holding competitive balance picks can send them, and pool money trades only during the international signing period.' : 'No offers for him with that request.'); })}>Ask every team</button>
        </div>
      )}

      {mode === 'need' && (
        <div className="form-row">
          Position:{' '}
          <select value={need} onChange={(e) => setNeed(e.target.value as Pos | 'OF' | 'LHP')}>{NEEDS.map((n) => <option key={n} value={n}>{n === 'LHP' ? 'Left-handed pitcher' : n}</option>)}</select>{' '}
          Max salary $<NumInput  style={{ width: 60 }} value={maxSal} onChange={(n) => setMaxSal(n)} />M{' '}
          <label><input type="checkbox" checked={mlbOnly} onChange={(e) => setMlbOnly(e.target.checked)} /> MLB players only</label>{' '}
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => setRows(fillNeed(league, need, { ...opts(), maxSalary: maxSal * 1e6, mlbOnly })))}>Search</button>
        </div>
      )}

      {busy && <p className="muted">Searching…</p>}
      {deals && deals.length > 0 && dealTable(deals, mode === 'shop')}
      {rows && (
        rows.length === 0 ? <p className="muted">Nobody available at {need} who'd upgrade your current option under those limits.</p> : (
          <table className="data compact">
            <thead><tr><th className="l">Player</th><th>Team</th><th title="Salary and how long the club controls him">Contract</th><th className="l">Cheapest package</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.p.id}>
                  <td className="l"><PName league={league} p={r.p} /></td>
                  <td>{league.orgs[r.p.orgId!].abbrev}</td>
                  <td><ContractCell league={league} p={r.p} /></td>
                  <td className="l">{r.deal ? <Assets league={league} side={0} d={r.deal} /> : <span className="muted">Nothing that works</span>}</td>
                  <td>{r.deal && <button className="btn btn-sm" onClick={() => open(r.deal!)}>Open in Trade</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
      <p className="muted small">Packages are what each club would accept today, built from the same valuations they use to answer your offers. "Value to you" is your front office's read of what you get minus what you give.</p>
    </>
  );
}
