import { useStore } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import { cbtTax, fmtMoney, orgPayroll, serviceClass, serviceLabel, type PayrollLine } from '../../core/contracts.ts';
import { DataTable, OrgSelect, type Column } from '../components.tsx';

export default function Payroll() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const orgId = route.query.org !== undefined ? Number(route.query.org) : league.userOrgId;
  const org = league.orgs[orgId];
  const s = league.settings;
  const pay = orgPayroll(league, org);
  const tax = cbtTax(pay.cbt, org.cbtPayerYears, s);
  const years = [league.season, league.season + 1, league.season + 2, league.season + 3, league.season + 4];
  const cols: Column<PayrollLine>[] = [
    { key: 'name', label: 'Player', left: true, value: (l) => l.name, render: (l) => <a href={href('player', [l.pid])}>{l.name}</a> },
    { key: 'lvl', label: 'Level', value: (l) => l.level ?? '-' },
    { key: 'status', label: 'Status', left: true, value: (l) => l.status },
    { key: 'svc', label: 'Svc', value: (l) => league.players[l.pid].mlServiceDays, render: (l) => serviceLabel(league.players[l.pid].mlServiceDays, s) },
    { key: 'cls', label: 'Class', left: true, value: (l) => serviceClass(league.players[l.pid], s) },
    { key: 'cbt', label: `${league.season} (proj.)`, title: 'Projected season amount: split contracts count the MLB rate only for days in the majors', value: (l) => l.cbt, render: (l) => fmtMoney(l.cbt) },
    ...years.slice(1).map((y) => ({
      key: `y${y}`,
      label: String(y),
      value: (l: PayrollLine) => (l.exp >= y ? l.salary : 0),
      render: (l: PayrollLine) => (l.exp >= y ? fmtMoney(l.salary) : ''),
    })),
  ];
  const future = (y: number) => pay.lines.filter((l) => l.exp >= y).reduce((t, l) => t + l.salary, 0) + org.deadMoney.filter((d) => d.season === y).reduce((t, d) => t + d.amount, 0);
  const rate = s.cbtBaseRates[Math.min(org.cbtPayerYears, s.cbtBaseRates.length - 1)];
  return (
    <>
      <h1>Payroll & CBT <span className="muted small">{org.region} {org.name}</span></h1>
      <div className="form-row">
        <OrgSelect league={league} value={orgId} onChange={(id) => go('payroll', [], { org: id })} />
      </div>
      <div className="cards">
        <div className="kv">
          <div>Player payroll ({league.season}, projected)</div><div>{fmtMoney(pay.total)}</div>
          <div>Dead money</div><div>{fmtMoney(pay.dead)}</div>
          <div>Player benefits</div><div>{fmtMoney(s.playerBenefits)}</div>
          <div>CBT payroll</div><div><b>{fmtMoney(pay.cbt)}</b></div>
          <div>CBT threshold</div><div>{fmtMoney(s.cbtThreshold)} (tiers every {fmtMoney(s.cbtTierStep)})</div>
          <div>Over / under</div><div className={tax.over > 0 ? 'neg' : 'pos'}>{tax.over > 0 ? '+' : ''}{fmtMoney(tax.over)}</div>
          <div>Payer status</div><div>{org.cbtPayerYears === 0 ? 'First-time' : `${org.cbtPayerYears + 1}${org.cbtPayerYears === 1 ? 'nd' : 'rd+'} consecutive year`} ({Math.round(rate * 100)}% base rate)</div>
          <div>Projected tax</div><div>{tax.tax > 0 ? `${fmtMoney(tax.tax)} (tier ${tax.tier})` : 'None'}</div>
        </div>
        <div className="kv">
          {years.slice(1).map((y) => (
            <>
              <div key={`l${y}`}>{y} committed</div>
              <div key={`v${y}`}>{fmtMoney(future(y))}</div>
            </>
          ))}
        </div>
      </div>
      <p className="muted small">
        CBT payroll here is a projection: one-way contracts count their full salary; split (pre-arbitration) contracts count the MLB rate for days on the MLB roster or IL and the minor league rate otherwise. Base rates and surcharges are set in League Settings.
      </p>
      <h2>Contracts</h2>
      <DataTable cols={cols} rows={pay.lines} rowKey={(l) => l.pid} defaultSort={{ key: 'cbt', desc: true }} compact />
      {org.deadMoney.length > 0 && (
        <>
          <h2>Dead money</h2>
          <table className="data compact">
            <thead><tr><th className="l">Player</th><th>Season</th><th>Owed</th></tr></thead>
            <tbody>
              {org.deadMoney.map((d, i) => (
                <tr key={i}><td className="l">{d.name}</td><td>{d.season}</td><td>{fmtMoney(d.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
