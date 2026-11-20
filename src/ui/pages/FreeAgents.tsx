import { useState } from 'react';
import { useStore, changed, setMessage } from '../../store.ts';
import type { Level, Player } from '../../core/types.ts';
import { MINOR_LEVELS } from '../../core/types.ts';
import { signFreeAgent, posLabel } from '../../core/rules.ts';
import { serviceLabel } from '../../core/contracts.ts';
import { DataTable, type Column } from '../components.tsx';
import { bt, nameCol, ratingCols } from '../fmt.tsx';
import { isPitcher } from '../../core/ratings.ts';

function SignCell({ p }: { p: Player }) {
  const { league } = useStore();
  const [lvl, setLvl] = useState<Level>('AAA');
  if (!league) return null;
  const sign = (ml: boolean) => {
    const err = signFreeAgent(league, p, league.userOrgId, lvl, ml);
    setMessage(err ? `Can't sign ${p.first} ${p.last}: ${err}` : null);
    changed();
  };
  return (
    <span className="nowrap">
      <select value={lvl} onChange={(e) => setLvl(e.target.value as Level)}>
        {MINOR_LEVELS.map((l) => <option key={l}>{l}</option>)}
      </select>{' '}
      <button className="btn btn-sm" onClick={() => sign(false)}>MiLB deal</button>{' '}
      <button className="btn btn-sm" onClick={() => sign(true)} title="Major league minimum, added to the 40-man and active roster">ML deal</button>
    </span>
  );
}

export default function FreeAgents() {
  const { league } = useStore();
  if (!league) return null;
  const fas = Object.values(league.players).filter((p) => p.orgId === null);
  const cols: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'bt', label: 'B/T', value: bt },
    { key: 'age', label: 'Age', value: (p) => league.season - p.born },
    ...ratingCols(league),
    { key: 'svc', label: 'Svc', value: (p) => p.mlServiceDays, render: (p) => serviceLabel(p.mlServiceDays, league.settings) },
    { key: 'sign', label: '', noSort: true, render: (p) => <SignCell p={p} /> },
  ];
  const pitchers = fas.filter(isPitcher);
  const hitters = fas.filter((p) => !isPitcher(p));
  return (
    <>
      <h1>Free Agents</h1>
      <p className="muted small">
        In-season free agents: released players and unsigned minor leaguers. Minor league deals go straight to an affiliate; a major league deal pays the MLB minimum and needs open 40-man and active roster spots. Full offseason free agency comes in the next milestone.
      </p>
      <h2>Pitchers</h2>
      <DataTable cols={cols} rows={pitchers} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
      <h2>Position players</h2>
      <DataTable cols={cols} rows={hitters} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
    </>
  );
}
