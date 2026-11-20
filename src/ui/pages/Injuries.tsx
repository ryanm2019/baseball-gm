import { useStore } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { Player } from '../../core/types.ts';
import { posLabel } from '../../core/rules.ts';
import { DataTable, OrgLink, ActionSelect, type Column } from '../components.tsx';
import { nameCol, ratingCols } from '../fmt.tsx';
import { dayShort } from '../../core/settings.ts';

export default function Injuries() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const all = route.query.scope === 'all';
  const list = Object.values(league.players).filter((p) => (p.injury || p.il) && p.orgId !== null && (all || p.orgId === league.userOrgId));
  const cols: Column<Player>[] = [
    nameCol(league),
    { key: 'team', label: 'Team', left: true, value: (p) => p.orgId!, render: (p) => <OrgLink league={league} orgId={p.orgId} level={p.il?.returnLevel ?? p.level ?? 'MLB'} abbrev /> },
    { key: 'lvl', label: 'Level', value: (p) => p.il?.returnLevel ?? p.level ?? '' },
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    ...ratingCols(league),
    { key: 'inj', label: 'Injury', left: true, value: (p) => p.injury?.name ?? 'Healthy (on IL)' },
    { key: 'days', label: 'Days left', value: (p) => p.injury?.daysLeft ?? 0 },
    { key: 'il', label: 'IL', value: (p) => p.il?.type ?? '-' },
    { key: 'since', label: 'Since', value: (p) => p.il?.since ?? -1, render: (p) => (p.il ? dayShort(league.season, p.il.since) : '') },
  ];
  if (!all) cols.push({ key: 'act', label: '', noSort: true, render: (p) => <ActionSelect league={league} p={p} /> });
  return (
    <>
      <h1>Injuries</h1>
      <div className="btn-group tabs">
        <button className={`btn btn-sm${!all ? ' active' : ''}`} onClick={() => go('injuries')}>My organization</button>
        <button className={`btn btn-sm${all ? ' active' : ''}`} onClick={() => go('injuries', [], { scope: 'all' })}>League</button>
      </div>
      <DataTable cols={cols} rows={list} rowKey={(p) => p.id} defaultSort={{ key: 'days', desc: true }} compact />
    </>
  );
}
