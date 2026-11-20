import { useStore, changed, askConfirm } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { Staff, StaffRole } from '../../core/types.ts';
import { AGM_DUTIES, STAFF_NAMES, STAFF_ROLES } from '../../core/types.ts';
import { extendStaff, fireStaff, hireStaff, keyRating, staffOf } from '../../core/staff.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { DataTable, Rating, type Column } from '../components.tsx';

const ROLE_HELP: Record<StaffRole, string> = {
  AGM: 'Handles the jobs you hand him (below). Evaluation drives how well he judges players; negotiation drives contract outcomes.',
  MGR: 'Runs the MLB club in games. Tactics = how often he picks the right reliever. Style: old school lets starters go deeper and runs more; analytical pulls starters the third time through the order.',
  PC: 'Develops MLB pitchers. Health lowers MLB pitcher injury risk.',
  HC: 'Develops MLB hitters.',
  FD: 'Runs the affiliates you leave to him and develops minor leaguers. Evaluation = how well he judges readiness; philosophy = how fast he promotes.',
};

const ratingCols = (role: StaffRole): { key: keyof Staff; label: string }[] => {
  switch (role) {
    case 'AGM':
      return [{ key: 'evaluation', label: 'Evaluation' }, { key: 'negotiation', label: 'Negotiation' }];
    case 'MGR':
      return [{ key: 'tactics', label: 'Tactics' }];
    case 'PC':
      return [{ key: 'development', label: 'Development' }, { key: 'health', label: 'Health' }];
    case 'HC':
      return [{ key: 'development', label: 'Development' }];
    case 'FD':
      return [{ key: 'development', label: 'Development' }, { key: 'evaluation', label: 'Evaluation' }];
  }
};

const extra = (s: Staff) => (s.role === 'MGR' ? s.style : s.role === 'FD' ? s.philosophy : '');

export default function StaffPage() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const role = (route.query.role ?? 'AGM') as StaffRole;
  const pool = league.staff.filter((s) => s.orgId === null && s.role === role);

  const cols: Column<Staff>[] = [
    { key: 'name', label: 'Name', left: true, value: (s) => `${s.last} ${s.first}`, render: (s) => `${s.first} ${s.last}` },
    { key: 'age', label: 'Age', value: (s) => s.age },
    ...ratingCols(role).map((c) => ({ key: c.key, label: c.label, value: (s: Staff) => s[c.key] as number, render: (s: Staff) => <Rating v={s[c.key] as number} /> })),
    ...(role === 'MGR' || role === 'FD' ? [{ key: 'style', label: role === 'MGR' ? 'Style' : 'Philosophy', left: true, value: extra } as Column<Staff>] : []),
    { key: 'sal', label: 'Salary', value: (s) => s.salary, render: (s) => fmtMoney(s.salary) },
    {
      key: 'hire',
      label: '',
      noSort: true,
      render: (s) => (
        <button
          className="btn btn-sm"
          onClick={async () => {
            const cur = staffOf(league, org, role);
            if (cur && !(await askConfirm(`Replace ${cur.first} ${cur.last} with ${s.first} ${s.last}?`))) return;
            hireStaff(league, org, s);
            changed();
          }}
        >
          Hire
        </button>
      ),
    },
  ];

  return (
    <>
      <h1>Staff</h1>
      <table className="data">
        <thead>
          <tr><th className="l">Role</th><th className="l">Name</th><th>Age</th><th className="l">Ratings</th><th>Salary</th><th>Contract</th><th /></tr>
        </thead>
        <tbody>
          {STAFF_ROLES.map((r) => {
            const s = staffOf(league, org, r);
            return (
              <tr key={r}>
                <td className="l"><a href={`#/staff?role=${r}`}>{STAFF_NAMES[r]}</a></td>
                {s ? (
                  <>
                    <td className="l">{s.first} {s.last}</td>
                    <td>{s.age}</td>
                    <td className="l">
                      {ratingCols(r).map((c) => (
                        <span key={c.key} style={{ marginRight: 12 }}>
                          {c.label} <Rating v={s[c.key] as number} />
                        </span>
                      ))}
                      {extra(s) && <span className="muted">{extra(s)}</span>}
                    </td>
                    <td>{fmtMoney(s.salary)}</td>
                    <td>thru {s.exp}</td>
                    <td className="nowrap">
                      <button className="btn btn-sm" onClick={() => { extendStaff(league, s, 2); changed(); }}>Extend 2 yrs</button>{' '}
                      <button className="btn btn-sm btn-danger" onClick={async () => { if (await askConfirm(`Fire ${s.first} ${s.last}?`)) { fireStaff(league, org, r); changed(); } }}>Fire</button>
                    </td>
                  </>
                ) : (
                  <td className="l neg" colSpan={6}>Vacant: hire one below</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Staff whose contracts run out leave when the new season starts unless you extend them.</p>

      <h2>Assistant GM duties</h2>
      {!staffOf(league, org, 'AGM') && <div className="alert alert-warn">You have no assistant GM, so you handle every job yourself.</div>}
      <p className="muted small">Checked jobs are handled by your assistant GM using his judgment. Unchecked jobs are yours: the sim stops when one needs a decision.</p>
      {AGM_DUTIES.map((d) => (
        <div key={d.key} className="form-row" style={{ margin: '2px 0' }}>
          <label>
            <input
              type="checkbox"
              checked={org.agm[d.key]}
              onChange={(e) => {
                org.agm[d.key] = e.target.checked;
                changed();
              }}
            />{' '}
            {d.label}
          </label>
        </div>
      ))}
      <p className="muted small">Trade offers will be added here with trades.</p>

      <h2>Hire: {STAFF_NAMES[role]}</h2>
      <div className="btn-group tabs">
        {STAFF_ROLES.map((r) => (
          <button key={r} className={`btn btn-sm${r === role ? ' active' : ''}`} onClick={() => go('staff', [], { role: r })}>
            {STAFF_NAMES[r]}
          </button>
        ))}
      </div>
      <p className="muted small">{ROLE_HELP[role]}</p>
      <DataTable cols={cols} rows={pool} rowKey={(s) => s.id} defaultSort={{ key: ratingCols(role)[0].key, desc: true }} />
      <p className="muted small">Best available by key rating: {pool.length ? Math.round(Math.max(...pool.map(keyRating))) : '-'}</p>
    </>
  );
}
