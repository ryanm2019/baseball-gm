import { useStore, changed } from '../../store.ts';
import { NumInput } from '../components.tsx';
import { href } from '../../router.ts';
import { DEPTS, deptEffect, deptSpend, effectText, facilitiesIn, facilitiesLabel, facilitiesTarget } from '../../core/depts.ts';
import { fmtMoney } from '../../core/contracts.ts';

export default function Departments() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const spend = deptSpend(org);
  const over = spend - org.opBudget;
  const rank = (key: (typeof DEPTS)[number]['key']) => {
    const vals = league.orgs.map((o) => (key === 'facilities' ? o.facilities : o.depts[key])).sort((a, b) => b - a);
    return vals.indexOf(key === 'facilities' ? org.facilities : org.depts[key]) + 1;
  };
  const avg = (key: (typeof DEPTS)[number]['key']) => league.orgs.reduce((t, o) => t + o.depts[key], 0) / league.orgs.length;
  const set = (key: (typeof DEPTS)[number]['key'], v: number) => {
    org.depts[key] = Math.max(0, Math.round(v / 0.25e6) * 0.25e6);
    changed();
  };

  return (
    <>
      <h1>Departments</h1>
      <p className="muted small">
        Annual budgets for each department, paid from the operating budget your owner sets separately from payroll. Spending about twice the normal amount gets the full benefit; half or less hurts. Changes take effect right away, except facilities, which build up week by week. Your staff hires (<a href={href('staff')}>Staff</a>) still matter on top of this: the budget sets how well the department runs, the staff set how good the people in it are.
      </p>
      <div className="kv" style={{ maxWidth: 520 }}>
        <div>Operating budget</div><div><b>{fmtMoney(org.opBudget)}</b> ({org.owner.first} {org.owner.last}, {org.owner.type.toLowerCase()})</div>
        <div>Budgeted</div><div className={over > 0 ? 'neg' : 'pos'}>{fmtMoney(spend)} {over > 0 ? `(${fmtMoney(over)} over: the owner will notice)` : `(${fmtMoney(-over)} under)`}</div>
      </div>
      <table className="data" style={{ maxWidth: 1000 }}>
        <thead>
          <tr><th className="l">Department</th><th>Budget</th><th /><th>League avg</th><th>Rank</th><th className="l">Effect</th></tr>
        </thead>
        <tbody>
          {DEPTS.map((d) => {
            const v = org.depts[d.key];
            const e = deptEffect(org, d.key);
            return (
              <tr key={d.key}>
                <td className="l" title={d.help}><b>{d.label}</b><div className="muted small">{d.help}</div></td>
                <td className="nowrap">
                  <button className="btn btn-sm" onClick={() => set(d.key, v - 1e6)}>−</button>{' '}
                  <NumInput
                    
                    step={0.5}
                    min={0}
                    style={{ width: 70 }}
                    value={(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}
                    onChange={(n) => set(d.key, n * 1e6)}
                  />{' '}
                  $M{' '}
                  <button className="btn btn-sm" onClick={() => set(d.key, v + 1e6)}>+</button>
                </td>
                <td style={{ width: 120 }}>
                  <input type="range" min={0} max={d.base * 2.5} step={0.25e6} value={v} onChange={(e2) => set(d.key, Number(e2.target.value))} style={{ width: 110 }} />
                </td>
                <td>{fmtMoney(avg(d.key))}</td>
                <td>{rank(d.key)}</td>
                <td className={`l small ${e > 0.05 ? "pos" : e < -0.05 ? "neg" : ""}`} style={{ whiteSpace: "normal", minWidth: 220 }}>
                  {effectText(org, d.key)}
                  {d.key === 'facilities' && <FacilitiesOutlook org={org} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">AI clubs budget by owner type and direction: rebuilding clubs lean into scouting and development, contenders into medical. Operating budgets are reset each spring.</p>
    </>
  );
}

function FacilitiesOutlook({ org }: { org: Parameters<typeof facilitiesTarget>[0] }) {
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${(6 * x).toFixed(1)}%`;
  const now = org.facilities ?? 0;
  const target = facilitiesTarget(org);
  const gap = target - now;
  if (Math.abs(gap) < 0.02) return <div className="muted">Holding steady at this spending level.</div>;
  return (
    <div className="muted">
      At this budget they're {gap > 0 ? 'improving' : 'wearing down'} toward {facilitiesLabel(target)} ({pct(target)}): {pct(facilitiesIn(org, 4))} in a month, {pct(facilitiesIn(org, 13))} in 3 months, {pct(facilitiesIn(org, 26))} in 6 months.
    </div>
  );
}
