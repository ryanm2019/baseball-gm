import { useStore } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import { dayShort } from '../../core/settings.ts';
import { OrgSelect } from '../components.tsx';

const TYPES = ['All', 'Trade', 'QO', 'Draft', 'Rule 5', 'Arbitration', 'Non-tender', 'Option', 'Recall', 'Select', 'Assign', 'IL', 'Activate', 'DFA', 'Waivers', 'Claim', 'Outright', 'Release', 'Sign', '40-man'];

export default function Transactions() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const scope = route.query.org ?? String(league.userOrgId);
  const type = route.query.type ?? 'All';
  const list = league.transactions
    .filter((t) => (scope === 'all' ? true : t.orgId === Number(scope)))
    .filter((t) => type === 'All' || t.type === type)
    .slice(-400)
    .reverse();
  return (
    <>
      <h1>Transactions</h1>
      <div className="form-row">
        <select value={scope === 'all' ? 'all' : 'one'} onChange={(e) => go('transactions', [], { org: e.target.value === 'all' ? 'all' : league.userOrgId, type })}>
          <option value="one">One team</option>
          <option value="all">All teams</option>
        </select>
        {scope !== 'all' && <OrgSelect league={league} value={Number(scope)} onChange={(id) => go('transactions', [], { org: id, type })} />}
        <select value={type} onChange={(e) => go('transactions', [], { org: scope, type: e.target.value })}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <p className="muted small">AI clubs' moves between their own minor league affiliates are not listed.</p>
      {list.length === 0 && <p className="muted">None.</p>}
      {list.map((t) => (
        <div key={t.id} className="news-item">
          <span className="muted small">{dayShort(t.season, t.day)}</span>{' '}
          {t.orgId !== null && <b>{league.orgs[t.orgId].abbrev}</b>} {t.text}{' '}
          {t.pids.map((id) => (
            <a key={id} href={href('player', [id])} className="small">
              (player)
            </a>
          ))}
        </div>
      ))}
    </>
  );
}
