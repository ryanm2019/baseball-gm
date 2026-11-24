// Trade Finder: get a player, shop one of yours, or fill a need.
import { useState } from 'react';
import { DataTable, NumInput, type Column } from '../components.tsx';
import { tradePlayerCols } from '../tradeCols.tsx';
import { markFloated } from '../../core/negotiation.ts';
import { PosFilterSelect, posFilterFn } from '../posFilter.tsx';
import { useStore, setMessage } from '../../store.ts';
import { go, href } from '../../router.ts';
import type { League, Player, Pos } from '../../core/types.ts';
import { fillNeed, findPackagesFor, shopPlayer, type FinderOpts, type FoundDeal, type NeedRow, type Want } from '../../core/tradeFinder.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { posLabel } from '../../core/rules.ts';
import { contractInfo, fmtMoney } from '../../core/contracts.ts';
import { orgPlayers } from '../../core/util.ts';
import { tradeWindowOpen, validateTrade } from '../../core/trade.ts';
import { loadTrade } from './Trade.tsx';
import { seasonSummary } from '../tradeCols.tsx';


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

// Everything on this screen is kept while you look at other pages (and come back).
const kept: Record<string, unknown> = {};
function useKept<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (key in kept ? (kept[key] as T) : init));
  return [v, (x: T) => { kept[key] = x; setV(x); }];
}

export default function TradeFinder() {
  const { league } = useStore();
  const [mode, setMode] = useKept<Mode>('mode', 'get');
  const [target, setTarget] = useKept('target', '');
  const [mine, setMine] = useKept<number | ''>('mine', '');
  const [want, setWant] = useKept<Want>('want', 'best');
  const [need, setNeed] = useKept<Pos | 'OF' | 'LHP'>('need', 'CF');
  const [kind, setKind] = useKept<FinderOpts['kind']>('kind', 'any');
  const [allowPicks, setAllowPicks] = useKept('allowPicks', true);
  const [maxSal, setMaxSal] = useKept('maxSal', 40);
  const [mlbOnly, setMlbOnly] = useKept('mlbOnly', true);
  const [untouch, setUntouch] = useKept<Set<number>>('untouch', new Set());
  const [busy, setBusy] = useState(false);
  const [shopPos, setShopPos] = useKept('shopPos', 'all');
  const [deals, setDeals] = useKept<FoundDeal[] | null>('deals', null);
  const [rows, setRows] = useKept<NeedRow[] | null>('rows', null);
  const [about, setAbout] = useKept<string>('about', ''); // who the results are for
  if (!league) return null;
  const user = league.orgs[league.userOrgId];
  const shopFor = (p: Player) => { setMine(p.id); run(() => { const ds = shopPlayer(league, p.id, want); found(ds, `offers for ${p.first} ${p.last}`); if (!ds.length) setMessage(want === 'picks' ? 'No offers in picks or pool money. Only clubs holding competitive balance picks can send them, and pool money trades only during the international signing period.' : 'No offers for him with that request.'); }); };
  const shopCols: Column<Player>[] = [
    { key: 'name', label: 'Player', left: true, value: (p) => `${p.last} ${p.first}`, render: (p) => <a href={href('player', [p.id])}>{p.first} {p.last}</a> },
    ...tradePlayerCols(league),
    { key: 'shop', label: '', noSort: true, render: (p) => <button className={`btn btn-sm${p.id === mine ? ' btn-primary' : ''}`} disabled={busy} onClick={() => shopFor(p)}>Ask every team</button> },
  ];
  const myPlayers = orgPlayers(league, user.id).filter((p) => p.on40 || p.level === 'MLB' || scoutedPot(league, p) >= 50).sort((a, b) => scoutedOvr(league, b) - scoutedOvr(league, a));
  const others = Object.values(league.players).filter((p) => p.orgId !== null && p.orgId !== user.id && (p.level === 'MLB' || p.on40 || p.level === 'AAA'));
  const opts = (): FinderOpts => ({ untouchable: untouch, allowPicks, kind });
  const closed = tradeWindowOpen(league);

  const run = (f: () => void) => { setBusy(true); setDeals(null); setRows(null); setTimeout(() => { try { f(); } finally { setBusy(false); } }, 20); };
  // The clubs put these packages on the table: send one as is (within a few days) and they'll take it.
  const found = (ds: FoundDeal[], label: string) => { for (const d of ds) markFloated(league, d.prop); setDeals(ds); setAbout(label); };
  // Results from an earlier visit: drop any that no longer work (players moved, etc.).
  const liveDeals = deals?.filter((d) => !validateTrade(league, d.prop)) ?? null;
  const findFor = (p: Player) => run(() => { const ds = findPackagesFor(league, p.id, opts()); found(ds, `${p.first} ${p.last}`); if (!ds.length) setMessage(`No package from your organization works for ${p.first} ${p.last} with these settings.`); });
  const blockPlayers = league.orgs.filter((o) => o.id !== user.id).flatMap((o) => o.block.map((id) => league.players[id]).filter((p) => p && p.orgId === o.id));
  const listed = target.length >= 2 ? others.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(target.toLowerCase())).slice(0, 40) : blockPlayers;
  const listCols: Column<Player>[] = [
    { key: 'name', label: 'Player', left: true, value: (p) => `${p.last} ${p.first}`, render: (p) => <a href={href('player', [p.id])}>{p.first} {p.last}</a> },
    { key: 'team', label: 'Team', value: (p) => league.orgs[p.orgId!].abbrev },
    ...tradePlayerCols(league),
    { key: 'find', label: '', noSort: true, render: (p) => <button className="btn btn-sm" disabled={busy} onClick={() => findFor(p)}>Find packages</button> },
  ];
  const open = (d: FoundDeal) => { loadTrade(d.prop.orgs[1], [d.prop.give[0], d.prop.give[1]]); go('trade'); };
  // Each package: a header (club, your front office's read, open it) and one
  // table of everyone in it, with ratings, contract and this season's numbers.
  const giveSet = (d: FoundDeal) => new Set(d.prop.give[0].pids);
  const dealCols = (d: FoundDeal): Column<Player>[] => [
    { key: 'side', label: '', left: true, noSort: true, render: (p) => (giveSet(d).has(p.id) ? <span className="neg small">You give</span> : <span className="pos small">You get</span>) },
    { key: 'name', label: 'Player', left: true, noSort: true, render: (p) => <a href={href('player', [p.id])}>{p.first} {p.last}</a> },
    ...tradePlayerCols(league).map((c) => ({ ...c, noSort: true })),
  ];
  const extras = (d: FoundDeal, side: 0 | 1) => {
    const g = d.prop.give[side];
    const bits = [g.cbPicks.length ? `${g.cbPicks.length} competitive balance pick${g.cbPicks.length > 1 ? 's' : ''}` : '', g.pool > 0 ? `${fmtMoney(g.pool)} international pool` : '', g.cash > 0 ? `${fmtMoney(g.cash)} cash` : ''].filter(Boolean);
    return bits.length ? <span className={side === 0 ? 'neg small' : 'pos small'}>{side === 0 ? 'You also give' : 'You also get'}: {bits.join(', ')}. </span> : null;
  };
  const dealTable = (ds: FoundDeal[], shop: boolean) => (
    <div>
      {ds.map((d, i) => {
        const o = league.orgs[d.prop.orgs[1]];
        const rows = [...d.prop.give[0].pids, ...d.prop.give[1].pids].map((id) => league.players[id]).filter(Boolean);
        return (
          <div key={i} className="card" style={{ margin: '8px 0', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6 }}>
            <div className="form-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
              <b>{o.abbrev}</b>
              <span className="muted small">{shop ? o.stance : d.note}</span>
              <span className="small" title="Your front office's valuation: what you get minus what you give">Value to you <b className={d.valueToYou >= d.costToYou ? 'pos' : 'neg'}>{fmtMoney(d.valueToYou - d.costToYou)}</b></span>
              {extras(d, 0)}{extras(d, 1)}
              <button className="btn btn-sm" onClick={() => open(d)}>Open in Trade</button>
            </div>
            <DataTable cols={dealCols(d)} rows={rows} rowKey={(p) => p.id} compact />
          </div>
        );
      })}
    </div>
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
          <div className="form-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input placeholder="Search any player in the league…" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 280 }} />
            <span className="muted small">{target.length >= 2 ? `Players matching "${target}"` : `On other clubs' trading blocks (${blockPlayers.length}). Search to find anyone else.`}</span>
          </div>
          {listed.length === 0
            ? <p className="muted small">{target.length >= 2 ? 'No one by that name.' : 'No one is on a trading block right now. Search for any player.'}</p>
            : <DataTable cols={listCols} rows={listed} rowKey={(p) => p.id} compact maxHeight={360} />}
        </>
      )}

      {mode === 'shop' && (
        <>
          <div className="form-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            What you want back:{' '}
            <select value={want} onChange={(e) => setWant(e.target.value as Want)}>
              <option value="best">Best offer</option><option value="prospects">Prospects</option><option value="mlb">MLB talent</option><option value="picks">Picks and pool money</option>
            </select>
            <PosFilterSelect value={shopPos} onChange={setShopPos} />
            <span className="muted small">Pick one of your players and ask every team what they'd give.</span>
          </div>
          <DataTable cols={shopCols} rows={myPlayers.filter(posFilterFn(shopPos))} rowKey={(p) => p.id} compact maxHeight={380} pinned={(p) => p.id === mine} />
        </>
      )}

      {mode === 'need' && (
        <div className="form-row">
          Position:{' '}
          <select value={need} onChange={(e) => setNeed(e.target.value as Pos | 'OF' | 'LHP')}>{NEEDS.map((n) => <option key={n} value={n}>{n === 'LHP' ? 'Left-handed pitcher' : n}</option>)}</select>{' '}
          Max salary $<NumInput  style={{ width: 60 }} value={maxSal} onChange={(n) => setMaxSal(n)} />M{' '}
          <label><input type="checkbox" checked={mlbOnly} onChange={(e) => setMlbOnly(e.target.checked)} /> MLB players only</label>{' '}
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => { const rs = fillNeed(league, need, { ...opts(), maxSalary: maxSal * 1e6, mlbOnly }); for (const r of rs) if (r.deal) markFloated(league, r.deal.prop); setRows(rs); setAbout(`${need} upgrades`); })}>Search</button>
        </div>
      )}

      {busy && <p className="muted">Searching…</p>}
      {liveDeals && liveDeals.length > 0 && <h3 style={{ marginBottom: 4 }}>Packages{about ? `: ${about}` : ''}</h3>}
      {liveDeals && liveDeals.length > 0 && dealTable(liveDeals, mode === 'shop')}
      {rows && (
        rows.length === 0 ? <p className="muted">Nobody available at {need} who'd upgrade your current option under those limits.</p> : (
          <DataTable
            cols={[
              { key: 'name', label: 'Player', left: true, value: (r: NeedRow) => r.p.last, render: (r: NeedRow) => <a href={href('player', [r.p.id])}>{r.p.first} {r.p.last}</a> },
              { key: 'team', label: 'Team', value: (r: NeedRow) => league.orgs[r.p.orgId!].abbrev },
              ...tradePlayerCols(league).map((c) => ({ ...c, value: c.value ? (r: NeedRow) => c.value!(r.p) : undefined, render: c.render ? (r: NeedRow) => c.render!(r.p) : undefined })) as Column<NeedRow>[],
              { key: 'pkg', label: 'Cheapest package (hover names for details)', left: true, noSort: true, render: (r: NeedRow) => (r.deal ? <Assets league={league} side={0} d={r.deal} /> : <span className="muted">Nothing that works</span>) },
              { key: 'open', label: '', noSort: true, render: (r: NeedRow) => r.deal && <button className="btn btn-sm" onClick={() => open(r.deal!)}>Open in Trade</button> },
            ]}
            rows={rows}
            rowKey={(r) => r.p.id}
            compact
          />
        )
      )}
      <p className="muted small">Packages are what each club would accept today, built from the same valuations they use to answer your offers. "Value to you" is your front office's read of what you get minus what you give.</p>
    </>
  );
}
