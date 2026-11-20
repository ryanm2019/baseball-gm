import { useStore, changed, askConfirm } from '../../store.ts';
import { fireFarmDirector, farmDirectorOf, hireFarmDirector } from '../../core/farmDirector.ts';
import { fmtMoney } from '../../core/contracts.ts';
import type { FarmDirector } from '../../core/types.ts';
import { DataTable, type Column } from '../components.tsx';

const PHIL_TEXT = {
  Conservative: 'Waits for a big sample and clear readiness before promoting.',
  Balanced: 'Promotes ready players after a reasonable sample.',
  Aggressive: 'Pushes prospects quickly, sometimes before they are ready.',
};

export default function Staff() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const fd = farmDirectorOf(league, org);
  const pool = league.farmDirectors.filter((f) => f.orgId === null);
  const cols: Column<FarmDirector>[] = [
    { key: 'name', label: 'Name', left: true, value: (f) => `${f.last} ${f.first}`, render: (f) => `${f.first} ${f.last}` },
    { key: 'age', label: 'Age', value: (f) => f.age },
    { key: 'dev', label: 'Development', title: 'Speeds up player development across the system', value: (f) => f.development },
    { key: 'eval', label: 'Evaluation', title: 'How accurately he judges players when moving them', value: (f) => f.evaluation },
    { key: 'phil', label: 'Philosophy', left: true, value: (f) => f.philosophy },
    { key: 'sal', label: 'Salary', value: (f) => f.salary, render: (f) => fmtMoney(f.salary) },
    {
      key: 'hire',
      label: '',
      noSort: true,
      render: (f) => (
        <button
          className="btn btn-sm"
          onClick={async () => {
            if (fd && !(await askConfirm(`Replace ${fd.first} ${fd.last} with ${f.first} ${f.last}?`))) return;
            hireFarmDirector(league, org, f);
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
      <h2>Farm director</h2>
      {fd ? (
        <div className="kv" style={{ maxWidth: 520 }}>
          <div>Name</div><div>{fd.first} {fd.last} ({fd.age})</div>
          <div>Development</div><div>{fd.development}</div>
          <div>Evaluation</div><div>{fd.evaluation}</div>
          <div>Philosophy</div><div>{fd.philosophy}: {PHIL_TEXT[fd.philosophy]}</div>
          <div>Salary</div><div>{fmtMoney(fd.salary)}</div>
        </div>
      ) : (
        <p className="neg">No farm director. Affiliates set to farm director control won't be managed until you hire one.</p>
      )}
      {fd && (
        <p>
          <button className="btn btn-sm btn-danger" onClick={async () => { if (await askConfirm(`Fire ${fd.first} ${fd.last}?`)) { fireFarmDirector(league, org); changed(); } }}>
            Fire
          </button>
        </p>
      )}
      <h2>Available farm directors</h2>
      <DataTable cols={cols} rows={pool} rowKey={(f) => f.id} defaultSort={{ key: 'dev', desc: true }} />
      <p className="muted small">Ratings are on the 20-80 scale. Coaching staffs, scouting directors and managers come in a later milestone.</p>
    </>
  );
}
