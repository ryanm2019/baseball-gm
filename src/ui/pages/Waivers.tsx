import { useStore, changed } from '../../store.ts';
import type { Player } from '../../core/types.ts';
import { waiverClaims, posLabel } from '../../core/rules.ts';
import { fortyMan } from '../../core/util.ts';
import { serviceLabel } from '../../core/contracts.ts';
import { tradePlayerCols } from '../tradeCols.tsx';
import { DataTable, OrgLink, type Column } from '../components.tsx';
import { ContractCell, nameCol, ratingCols, optionsLeft } from '../fmt.tsx';
import { dayShort } from '../../core/settings.ts';

export default function Waivers() {
  const { league } = useStore();
  if (!league) return null;
  const s = league.settings;
  const onWaivers = Object.values(league.players).filter((p) => p.waivers);
  const dfa = Object.values(league.players).filter((p) => p.dfa);
  const claims = waiverClaims(league);
  const base: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'age', label: 'Age', value: (p) => league.season - p.born },
    ...ratingCols(league),
    // This season's numbers (all levels) right beside the ratings.
    ...tradePlayerCols(league).filter((c) => ['n', 'wrc', 'fipm', 'line'].includes(c.key)),
    { key: 'sal', label: 'Contract', value: (p) => p.contract.salary, render: (p) => <ContractCell league={league} p={p} /> },
    { key: 'svc', label: 'Svc', value: (p) => p.mlServiceDays, render: (p) => serviceLabel(p.mlServiceDays, s) },
    { key: 'opt', label: 'Opt', value: (p) => optionsLeft(league, p) },
  ];
  const wCols: Column<Player>[] = [
    ...base,
    { key: 'from', label: 'From', left: true, value: (p) => p.waivers!.fromOrg, render: (p) => <OrgLink league={league} orgId={p.waivers!.fromOrg} abbrev /> },
    { key: 'type', label: 'Type', value: (p) => p.waivers!.type },
    { key: 'ends', label: 'Clears', value: (p) => p.waivers!.day, render: (p) => dayShort(league.season, p.waivers!.day + s.waiverDays) },
    {
      key: 'claim',
      label: '',
      noSort: true,
      render: (p) => {
        if (p.waivers!.fromOrg === league.userOrgId) return <span className="muted small">yours</span>;
        const mine = (claims[p.id] ?? []).includes(league.userOrgId);
        const full = fortyMan(league, league.userOrgId).length >= s.fortyMax;
        return (
          <>
          <button
            className="btn btn-sm"
            onClick={() => {
              const list = claims[p.id] ?? [];
              claims[p.id] = mine ? list.filter((x) => x !== league.userOrgId) : [...list, league.userOrgId];
              changed();
            }}
          >
            {mine ? 'Cancel claim' : 'Claim'}
          </button>
          {full && <span className="muted small" title="If the claim is awarded you'll need to clear a 40-man spot (your assistant GM does it if he runs the roster)."> 40-man full</span>}
          </>
        );
      },
    },
  ];
  const dCols: Column<Player>[] = [
    ...base,
    { key: 'team', label: 'Team', left: true, value: (p) => p.orgId ?? -1, render: (p) => <OrgLink league={league} orgId={p.orgId} abbrev /> },
    { key: 'since', label: 'Designated', value: (p) => p.dfa!.day, render: (p) => dayShort(league.season, p.dfa!.day) },
  ];
  return (
    <>
      <h1>Waivers</h1>
      <p className="muted small">
        Claims are awarded in reverse order of MLB winning percentage. A claiming team takes on the contract and puts him on its 40-man. You can claim with a full 40-man: if the claim is awarded you'll need to clear a spot before the next sim day (your assistant GM does it if he runs the roster), and AI clubs drop their weakest 40-man player. If a club ahead of you in priority claims him, you'll get a note. Before a player reaches waivers, a club that really wants him may call you with a small trade instead. Players who clear outright waivers are outrighted to Triple-A; those with {s.outrightRefuseServiceYears}+ years of service or a previous outright can elect free agency instead.
      </p>
      <h2>On waivers</h2>
      <DataTable cols={wCols} rows={onWaivers} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
      <h2>Designated for assignment</h2>
      <DataTable cols={dCols} rows={dfa} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
    </>
  );
}
