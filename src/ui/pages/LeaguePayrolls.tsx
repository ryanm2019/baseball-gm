import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
import { cbtTax, fmtMoney, orgPayroll } from '../../core/contracts.ts';
import type { Org } from '../../core/types.ts';
import { DataTable, type Column } from '../components.tsx';

interface Row {
  o: Org;
  total: number;
  cbt: number;
  tax: number;
  over: number;
}

export default function LeaguePayrolls() {
  const { league } = useStore();
  if (!league) return null;
  const rows: Row[] = league.orgs.map((o) => {
    const p = orgPayroll(league, o);
    const t = cbtTax(p.cbt, o.cbtPayerYears, league.settings);
    return { o, total: p.total, cbt: p.cbt, tax: t.tax, over: t.over };
  });
  const st = league.standings.MLB;
  const cols: Column<Row>[] = [
    { key: 'team', label: 'Team', left: true, value: (r) => r.o.region, render: (r) => <a href={href('payroll', [], { org: r.o.id })}>{r.o.region} {r.o.name}</a> },
    { key: 'wl', label: 'W-L', value: (r) => st[r.o.id].w, render: (r) => `${st[r.o.id].w}-${st[r.o.id].l}` },
    { key: 'total', label: 'Payroll', value: (r) => r.total, render: (r) => fmtMoney(r.total) },
    { key: 'cbt', label: 'CBT payroll', value: (r) => r.cbt, render: (r) => fmtMoney(r.cbt) },
    { key: 'over', label: 'vs threshold', value: (r) => r.over, render: (r) => <span className={r.over > 0 ? 'neg' : ''}>{r.over > 0 ? '+' : ''}{fmtMoney(r.over)}</span> },
    { key: 'tax', label: 'Proj. tax', value: (r) => r.tax, render: (r) => (r.tax ? fmtMoney(r.tax) : '') },
  ];
  return (
    <>
      <h1>League Payrolls</h1>
      <p className="muted">CBT threshold: {fmtMoney(league.settings.cbtThreshold)}</p>
      <DataTable cols={cols} rows={rows} rowKey={(r) => r.o.id} defaultSort={{ key: 'cbt', desc: true }} rowClass={(r) => (r.o.id === league.userOrgId ? 'user' : undefined)} />
    </>
  );
}
