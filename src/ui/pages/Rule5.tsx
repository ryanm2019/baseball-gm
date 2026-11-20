import { useStore, changed, setMessage } from '../../store.ts';
import { href } from '../../router.ts';
import type { Player } from '../../core/types.ts';
import { rule5Eligible } from '../../core/offseason.ts';
import { addTo40, canAdd40, posLabel } from '../../core/rules.ts';
import { orgPlayers, fortyMan } from '../../core/util.ts';
import { DataTable, OrgLink, type Column } from '../components.tsx';
import { nameCol, ratingCols } from '../fmt.tsx';
import { delegated } from '../../core/staff.ts';

export default function Rule5() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const mine = orgPlayers(league, org.id).filter((p) => rule5Eligible(league, p));
  const others = Object.values(league.players).filter((p) => p.orgId !== org.id && rule5Eligible(league, p));
  const picks = Object.values(league.players).filter((p) => p.rule5 && (p.orgId === org.id || p.rule5.fromOrg === org.id));
  const age = (p: Player) => league.season - p.born;

  const base: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'age', label: 'Age', value: age },
    { key: 'lvl', label: 'Level', value: (p) => p.level ?? '' },
    ...ratingCols(league),
    { key: 'pro', label: 'Pro yrs', value: (p) => p.proSeasons },
  ];
  const mineCols: Column<Player>[] = [
    ...base,
    {
      key: 'protect',
      label: '',
      noSort: true,
      render: (p) => {
        const why = canAdd40(league, p);
        return (
          <button className="btn btn-sm" disabled={!!why} title={why ?? ''} onClick={() => { addTo40(league, p); changed(); }}>
            Protect (add to 40)
          </button>
        );
      },
    },
  ];
  const otherCols: Column<Player>[] = [
    ...base,
    { key: 'org', label: 'Org', left: true, value: (p) => p.orgId ?? -1, render: (p) => <OrgLink league={league} orgId={p.orgId} level={p.level ?? 'MLB'} abbrev /> },
    {
      key: 'target',
      label: 'Target',
      noSort: true,
      render: (p) => {
        const i = org.rule5Targets.indexOf(p.id);
        return (
          <button
            className="btn btn-sm"
            onClick={() => {
              if (i >= 0) org.rule5Targets.splice(i, 1);
              else if (org.rule5Targets.length >= 5) setMessage('You can list up to 5 Rule 5 targets.');
              else org.rule5Targets.push(p.id);
              changed();
            }}
          >
            {i >= 0 ? `#${i + 1} (remove)` : 'Add'}
          </button>
        );
      },
    },
  ];

  return (
    <>
      <h1>Rule 5 Draft</h1>
      <p className="muted small">
        Players not on a 40-man roster are eligible after 4 pro seasons if they signed at 19 or older, or 5 if they signed at 18 or younger. Protect them by adding them to the 40-man before November 18. The draft is December 10, in reverse order of the standings; a team needs an open 40-man spot to pick. A Rule 5 pick must stay on the MLB active roster all season or be offered back.
      </p>
      <p>
        40-man: <b>{fortyMan(league, org.id).length}</b>/{league.settings.fortyMax}
        {delegated(league, org, 'rule5protect') && ' · Your assistant GM handles protection.'}
        {delegated(league, org, 'rule5draft') && ' · Your assistant GM makes your picks.'}
      </p>
      {picks.length > 0 && (
        <>
          <h2>Rule 5 players</h2>
          {picks.map((p) => (
            <div key={p.id}>
              <a href={href('player', [p.id])}>{p.first} {p.last}</a>: {p.orgId === org.id ? `your pick from the ${league.orgs[p.rule5!.fromOrg].affiliates.MLB.name}` : `taken by the ${league.orgs[p.orgId!].affiliates.MLB.name}`}
            </div>
          ))}
        </>
      )}
      <h2>Your eligible, unprotected players ({mine.length})</h2>
      <DataTable cols={mineCols} rows={mine} rowKey={(p) => p.id} defaultSort={{ key: 'pot', desc: true }} compact />
      <h2>Your targets</h2>
      {org.rule5Targets.length === 0 ? (
        <p className="muted">None. Add up to 5 from the list below, in order of preference.</p>
      ) : (
        <ol>
          {org.rule5Targets.map((id) => league.players[id] && <li key={id}>{league.players[id].first} {league.players[id].last}</li>)}
        </ol>
      )}
      <h2>Eligible players in other organizations</h2>
      <DataTable cols={otherCols} rows={others.filter((p) => age(p) <= 28)} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
    </>
  );
}
