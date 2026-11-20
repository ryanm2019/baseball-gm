// Your players you could extend: service time, what the deal would buy out,
// whether he'll talk, and a link to negotiate.
import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
import type { Player } from '../../core/types.ts';
import { fmtMoney, serviceYears } from '../../core/contracts.ts';
import { extRefusal, extYears } from '../../core/extensions.ts';
import { describeContract } from '../../core/terms.ts';
import { posLabel } from '../../core/rules.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { orgPlayers } from '../../core/util.ts';
import { DataTable, type Column } from '../components.tsx';

export default function Extensions() {
  const { league } = useStore();
  if (!league) return null;
  const s = league.settings;
  const rows = orgPlayers(league, league.userOrgId).filter((p) => p.contract.type === 'ML' && p.on40);
  const stage = (p: Player) => {
    const y = extYears(league, p, 6);
    const fa = y.findIndex((x) => x.status === 'FA');
    return fa < 0 ? 'Controlled 6+ more years' : fa === 0 ? 'Free agent after current deal' : `${fa} more controlled year${fa === 1 ? '' : 's'} (${y.slice(0, fa).map((x) => x.status).join(', ')})`;
  };
  const cols: Column<Player>[] = [
    { key: 'name', label: 'Player', left: true, value: (p) => `${p.last} ${p.first}`, render: (p) => <a href={href('player', [p.id])}>{p.first} {p.last}</a> },
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'age', label: 'Age', value: (p) => league.season - p.born },
    { key: 'ovr', label: 'Ovr', value: (p) => scoutedOvr(league, p) },
    { key: 'pot', label: 'Pot', value: (p) => scoutedPot(league, p) },
    { key: 'svc', label: 'Svc', value: (p) => serviceYears(p.mlServiceDays, s), render: (p) => serviceYears(p.mlServiceDays, s).toFixed(3) },
    { key: 'sal', label: 'Salary', value: (p) => p.contract.salary, render: (p) => fmtMoney(p.contract.salary) },
    { key: 'deal', label: 'Contract', left: true, value: (p) => p.contract.exp, render: (p) => <span className="small">{describeContract(league, p.contract)}{p.arb && p.arb.settled === null ? ' · arbitration pending' : ''}</span> },
    { key: 'stage', label: 'Control', left: true, value: (p) => stage(p), render: (p) => <span className="small">{stage(p)}</span> },
    { key: 'talk', label: 'Talks', left: true, value: (p) => (extRefusal(league, p) ? 1 : 0), render: (p) => <span className={`small${extRefusal(league, p) ? ' neg' : ''}`}>{extRefusal(league, p) ?? 'Open'}</span> },
    { key: 'go', label: '', noSort: true, render: (p) => <a className="btn btn-sm" href={href('negotiate', ['ext', p.id])}>Negotiate</a> },
  ];
  return (
    <>
      <h1>Contract Extensions</h1>
      <p className="muted small">
        Extend players before they reach arbitration or free agency. Each season the deal covers is valued by what he'd otherwise earn; the earlier in his career, the bigger the discount he takes for security. Extending a player during the arbitration process settles his case without a hearing. Some players won't negotiate during the season, and a few won't negotiate at all before free agency.
      </p>
      <DataTable cols={cols} rows={rows} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
    </>
  );
}
