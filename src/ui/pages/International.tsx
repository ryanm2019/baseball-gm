import { useStore, changed, setMessage } from '../../store.ts';
import type { Player } from '../../core/types.ts';
import { canSignIfa, isIfa, poolFor, signIfa } from '../../core/intl.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { posLabel } from '../../core/rules.ts';
import { DataTable, type Column } from '../components.tsx';
import { bt, nameCol, ratingCols } from '../fmt.tsx';
import { delegated } from '../../core/staff.ts';

export default function International() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const pool = league.intl.pools[org.id] ?? poolFor(org.market);
  const spent = league.intl.spent[org.id] ?? 0;
  const cls = Object.values(league.players).filter(isIfa);
  const signed = Object.values(league.players).filter((p) => p.orgId === org.id && p.contract.bonus && p.signAge !== undefined && p.signAge <= 17 && p.level === 'DSL');
  const cols: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'bt', label: 'B/T', value: bt },
    { key: 'country', label: 'From', left: true, value: (p) => p.country },
    { key: 'age', label: 'Age', value: (p) => (p.ifa?.year ?? league.season) - p.born },
    ...ratingCols(league),
    { key: 'ask', label: 'Asking', value: (p) => p.ifa?.asking ?? 0, render: (p) => fmtMoney(p.ifa?.asking ?? 0) },
    {
      key: 'sign',
      label: '',
      noSort: true,
      render: (p) => {
        const why = canSignIfa(league, org.id, p);
        return (
          <button
            className="btn btn-sm"
            disabled={!!why}
            title={why ?? ''}
            onClick={() => {
              const err = signIfa(league, org.id, p);
              setMessage(err);
              changed();
            }}
          >
            Sign
          </button>
        );
      },
    },
  ];
  return (
    <>
      <h1>International Amateurs</h1>
      <p>
        Bonus pool: <b>{fmtMoney(pool)}</b> · Spent: <b>{fmtMoney(spent)}</b> · Left: <b>{fmtMoney(pool - spent)}</b>
        {!league.intl.open && <span className="muted"> · The signing period opens January 15. The class is revealed December 15.</span>}
      </p>
      {delegated(league, org, 'ifa') && <p className="muted small">Your assistant GM is signing players with your pool.</p>}
      <p className="muted small">Signed players report to your DSL club. Scouting reports on 16-year-olds are rough.</p>
      <DataTable cols={cols} rows={cls} rowKey={(p) => p.id} defaultSort={{ key: 'ask', desc: true }} compact />
      {signed.length > 0 && (
        <>
          <h2>Signed</h2>
          {signed.map((p) => <div key={p.id}>{p.first} {p.last} ({p.country}) {fmtMoney(p.contract.bonus ?? 0)}</div>)}
        </>
      )}
    </>
  );
}
