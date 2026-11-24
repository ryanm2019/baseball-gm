import { PosFilterSelect, posFilterFn } from '../posFilter.tsx';
import { useState } from 'react';
import { useStore, changed } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { Level, Player } from '../../core/types.ts';
import { LEVELS } from '../../core/types.ts';
import { activeAt, activeLimit, countPitchers, fortyMan, orgPlayers, pitcherLimit } from '../../core/util.ts';
import { isPitcher } from '../../core/ratings.ts';
import { ActionSelect, DataTable, LevelTabs, OrgSelect, type Column } from '../components.tsx';
import { batStatCols, bt, contractCols, nameCol, pitStatCols, ratingCols, seasonBat, seasonPit } from '../fmt.tsx';
import { posLabel } from '../../core/rules.ts';
import { LEVEL_NAMES } from '../../core/settings.ts';
import { farmDirectorOf } from '../../core/farmDirector.ts';
import { playerTradeBlock } from '../../core/trade.ts';

const VIEWS = [
  { key: '40', label: '40-Man' },
  { key: 'IL', label: 'Injured List' },
  { key: 'DFA', label: 'DFA / Waivers' },
];

let rosterPos = 'all';

export default function Roster() {
  const { league } = useStore();
  const [pf, setPfState] = useState(rosterPos);
  const setPf = (v: string) => { rosterPos = v; setPfState(v); };
  const route = useRoute();
  if (!league) return null;
  const orgId = route.query.org !== undefined ? Number(route.query.org) : league.userOrgId;
  const view = route.query.level ?? 'MLB';
  const org = league.orgs[orgId];
  const isUser = orgId === league.userOrgId;

  let players: Player[];
  if (view === '40') players = orgPlayers(league, orgId).filter((p) => p.on40);
  else if (view === 'IL') players = orgPlayers(league, orgId).filter((p) => p.il);
  else if (view === 'DFA') players = orgPlayers(league, orgId).filter((p) => p.dfa || p.waivers);
  else players = activeAt(league, orgId, view as Level);

  const level = (LEVELS as string[]).includes(view) ? (view as Level) : null;
  const statLevel = level ?? undefined;
  const age = (p: Player) => league.season - p.born;

  const base: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    ...(level ? [] : [{ key: 'lvl', label: 'Level', value: (p: Player) => p.level ?? '-', left: false } as Column<Player>]),
    { key: 'bt', label: 'B/T', value: bt },
    { key: 'age', label: 'Age', value: age },
    ...ratingCols(league),
  ];
  const tail: Column<Player>[] = [...contractCols(league)];
  if (isUser) {
    tail.push({
      key: 'block',
      label: 'Block',
      title: 'On your trading block (shopped to other clubs)',
      value: (p) => (org.block.includes(p.id) ? 1 : 0),
      sortDesc: true,
      render: (p) =>
        playerTradeBlock(league, p) ? (
          <span className="muted" title={playerTradeBlock(league, p) ?? ''}>-</span>
        ) : (
          <input
            type="checkbox"
            title="Put on trading block"
            checked={org.block.includes(p.id)}
            onChange={() => {
              org.block = org.block.includes(p.id) ? org.block.filter((x) => x !== p.id) : [...org.block, p.id];
              changed();
            }}
          />
        ),
    });
    tail.push({ key: 'act', label: '', noSort: true, render: (p) => <ActionSelect league={league} p={p} /> });
  }

  const pitchers = players.filter(isPitcher).filter(posFilterFn(pf));
  const hitters = players.filter((p) => !isPitcher(p)).filter(posFilterFn(pf));
  const pitCols = [...base, ...pitStatCols((p) => seasonPit(p, league.season, statLevel)), ...tail];
  const batCols = [...base, ...batStatCols((p) => seasonBat(p, league.season, statLevel)), ...tail];

  const setQ = (q: Record<string, string | number>) => go('roster', [], { org: orgId, level: view, ...q });
  const fd = farmDirectorOf(league, org);
  const title = level ? `${org.affiliates[level].name}` : `${org.region} ${org.name}`;

  return (
    <>
      <h1>
        {title} <span className="muted small">{level ? LEVEL_NAMES[level] : VIEWS.find((v) => v.key === view)?.label}</span>
      </h1>
      <div className="form-row">
        <OrgSelect league={league} value={orgId} onChange={(id) => setQ({ org: id })} />
      </div>
      <LevelTabs value={view} onChange={(v) => setQ({ level: v })} extra={VIEWS} />
      {level === 'MLB' && (
        <p>
          Active roster: <b>{players.length}</b>/{activeLimit(league)} ({countPitchers(players)} pitchers, max {pitcherLimit(league)}) · 40-man:{' '}
          <b>{fortyMan(league, orgId).length}</b>/{league.settings.fortyMax}
        </p>
      )}
      {level && level !== 'MLB' && (
        <p>
          Active roster: <b>{players.length}</b>/{league.settings.milbActiveMax[level]} · Record {league.standings[level][orgId].w}-{league.standings[level][orgId].l}
          {isUser && (
            <>
              {' '}· Managed by:{' '}
              <select
                value={org.control[level]}
                onChange={(e) => {
                  org.control[level] = e.target.value as 'FD' | 'Manual';
                  changed();
                }}
              >
                <option value="FD">Farm director{fd ? ` (${fd.last})` : ' (none hired)'}</option>
                <option value="Manual">Me (manual)</option>
              </select>
            </>
          )}
        </p>
      )}
      {view === '40' && <p>40-man roster: <b>{fortyMan(league, orgId).length}</b>/{league.settings.fortyMax} (players on the 60-day IL don't count)</p>}

      <div className="form-row" style={{ margin: '6px 0' }}><PosFilterSelect value={pf} onChange={setPf} /></div>
      <h2>Pitchers</h2>
      <DataTable cols={pitCols} rows={pitchers} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
      <h2>Position players</h2>
      <DataTable cols={batCols} rows={hitters} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
      {isUser && <p className="muted small">Use the Move menu on each row. Greyed-out moves show why they aren't allowed right now. Check "Block" to shop a player on your <a href="#/trading-block">trading block</a>.</p>}
    </>
  );
}
