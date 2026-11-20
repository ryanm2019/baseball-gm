import { useStore } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { League, Level, Org, StandingRow } from '../../core/types.ts';
import { LevelTabs } from '../components.tsx';
import { LEVEL_NAMES } from '../../core/settings.ts';

const pct = (r: StandingRow) => (r.w + r.l ? r.w / (r.w + r.l) : 0);
const pctStr = (r: StandingRow) => (r.w + r.l ? pct(r).toFixed(3).replace(/^0/, '') : '.000');

function Table({ league, level, orgs, gbBase }: { league: League; level: Level; orgs: Org[]; gbBase?: StandingRow }) {
  const st = league.standings[level];
  const rows = [...orgs].sort((a, b) => pct(st[b.id]) - pct(st[a.id]) || st[b.id].rs - st[b.id].ra - (st[a.id].rs - st[a.id].ra));
  const lead = gbBase ?? st[rows[0].id];
  return (
    <div className="table-wrap">
      <table className="data compact">
        <thead>
          <tr><th className="l">Team</th><th>W</th><th>L</th><th>Pct</th><th>GB</th><th>RS</th><th>RA</th><th>Diff</th><th>Strk</th><th>L10</th></tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const r = st[o.id];
            const gb = (lead.w - r.w + (r.l - lead.l)) / 2;
            const l10w = [...r.last10].filter((c) => c === 'W').length;
            return (
              <tr key={o.id} className={o.id === league.userOrgId ? 'user' : ''}>
                <td className="l"><a href={href('roster', [], { org: o.id, level })}>{o.affiliates[level].name}</a></td>
                <td>{r.w}</td><td>{r.l}</td><td>{pctStr(r)}</td><td>{gb === 0 ? '-' : gb.toFixed(1)}</td><td>{r.rs}</td><td>{r.ra}</td>
                <td className={r.rs - r.ra >= 0 ? 'pos' : 'neg'}>{r.rs - r.ra > 0 ? '+' : ''}{r.rs - r.ra}</td>
                <td>{r.streak > 0 ? `W${r.streak}` : r.streak < 0 ? `L${-r.streak}` : '-'}</td>
                <td>{r.last10 ? `${l10w}-${r.last10.length - l10w}` : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Standings() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const level = (route.query.level ?? 'MLB') as Level;
  const st = league.standings.MLB;
  return (
    <>
      <h1>Standings <span className="muted small">{LEVEL_NAMES[level]}</span></h1>
      <LevelTabs value={level} onChange={(v) => go('standings', [], { level: v })} />
      {level === 'MLB' ? (
        <div className="cards">
          {(['AL', 'NL'] as const).map((lg) => {
            const orgs = league.orgs.filter((o) => o.league === lg);
            const leaders = (['East', 'Central', 'West'] as const).map((d) => orgs.filter((o) => o.div === d).sort((a, b) => pct(st[b.id]) - pct(st[a.id]))[0].id);
            const wc = orgs.filter((o) => !leaders.includes(o.id)).sort((a, b) => pct(st[b.id]) - pct(st[a.id]));
            const third = wc[2] ? st[wc[2].id] : undefined;
            return (
              <div key={lg} className="box">
                {(['East', 'Central', 'West'] as const).map((d) => (
                  <div key={d}>
                    <h3>{lg} {d}</h3>
                    <Table league={league} level="MLB" orgs={orgs.filter((o) => o.div === d)} />
                  </div>
                ))}
                <h3>{lg} Wild Card</h3>
                <Table league={league} level="MLB" orgs={wc} gbBase={third} />
              </div>
            );
          })}
        </div>
      ) : (
        <Table league={league} level={level} orgs={league.orgs} />
      )}
    </>
  );
}
