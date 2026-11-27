// The season in review: the champion, your club's year, and every award with
// the full voting (places, first-place votes, points, share).
import { useStore } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { AwardName, AwardVote, League } from '../../core/types.ts';
import { TeamBadge } from '../show.tsx';

const VOTED: AwardName[] = ['MVP', 'Cy Young', 'Rookie of the Year', 'Reliever of the Year'];
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

function PlayerLink({ league, pid }: { league: League; pid: number }) {
  const p = league.players[pid];
  return p ? <a href={href('player', [p.id])}>{p.first} {p.last}</a> : <>?</>;
}

function VoteTable({ league, v }: { league: League; v: AwardVote }) {
  const max = v.voters * v.scale[0];
  const w = v.rows[0];
  return (
    <div className="box" style={{ flex: '1 1 460px', minWidth: 0 }}>
      <div className="muted small">{v.lg} {v.award}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 8px' }}>
        <TeamBadge league={league} orgId={w.orgId} size={36} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}><PlayerLink league={league} pid={w.pid} /> <span className="muted small">{w.pos}, {league.orgs[w.orgId].abbrev}</span></div>
          <div className="small">{w.line}</div>
          <div className="small muted">{w.votes[0] === v.voters ? 'Unanimous' : `${w.votes[0]} of ${v.voters} first-place votes`}, {w.points} points</div>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}><table className="data compact">
        <thead><tr><th>#</th><th className="l">Player</th><th>Team</th><th className="l">Season</th><th title="First-place votes">1st</th><th>Pts</th><th title="Share of the maximum possible points">Share</th></tr></thead>
        <tbody>
          {v.rows.map((r, i) => (
            <tr key={r.pid} className={r.orgId === league.userOrgId ? 'user' : ''}>
              <td>{ord(i + 1)}</td>
              <td className="l nowrap"><PlayerLink league={league} pid={r.pid} /> <span className="muted small">{r.pos}</span></td>
              <td>{league.orgs[r.orgId].abbrev}</td>
              <td className="l small">{r.line}</td>
              <td>{r.votes[0] || ''}</td>
              <td>{r.points}</td>
              <td>{((100 * r.points) / max).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function SeasonReview() {
  const { league } = useStore();
  const { args } = useRoute();
  if (!league) return null;
  const seasons = [...new Set((league.awards ?? []).filter((a) => a.award === 'MVP').map((a) => a.season))].sort((a, b) => b - a);
  const season = args[0] ? Number(args[0]) : seasons[0];
  if (season === undefined) return <><h1>Season Review</h1><p className="muted">The season review comes out after the World Series.</p></>;
  const recs = (league.seasonRecs ?? []).filter((r) => r.season === season);
  const champ = recs.find((r) => r.result === 'Won World Series');
  const runner = recs.find((r) => r.result === 'Lost World Series');
  const mine = recs.find((r) => r.orgId === league.userOrgId);
  const awards = (league.awards ?? []).filter((a) => a.season === season);
  const votes = (league.awardVotes ?? []).filter((v) => v.season === season);
  const ourWins = awards.filter((a) => a.orgId === league.userOrgId && a.award !== 'All-Star');
  const ourVotes = votes.flatMap((v) => v.rows.map((r, i) => ({ v, r, place: i + 1 })).filter((x) => x.r.orgId === league.userOrgId && x.place > 1 && x.place <= 5));
  const best = (lg: 'AL' | 'NL') => [...recs].filter((r) => league.orgs[r.orgId].league === lg).sort((a, b) => b.w - a.w)[0];
  return (
    <>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {season} Season in Review
        <select value={season} onChange={(e) => go('season-review', [e.target.value])} style={{ fontSize: 14 }}>{seasons.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      </h1>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {champ && (
          <div className="box" style={{ flex: '1 1 300px' }}>
            <div className="muted small">World Series champion</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <TeamBadge league={league} orgId={champ.orgId} size={40} />
              <div><div style={{ fontSize: 20, fontWeight: 700 }}>{league.orgs[champ.orgId].region} {league.orgs[champ.orgId].name}</div><div className="small muted">{champ.w}-{champ.l}{runner ? ` · beat the ${league.orgs[runner.orgId].affiliates.MLB.name} (${runner.w}-${runner.l})` : ''}</div></div>
            </div>
          </div>
        )}
        {mine && (
          <div className="box" style={{ flex: '1 1 300px' }}>
            <div className="muted small">Your season: {league.orgs[league.userOrgId].region} {league.orgs[league.userOrgId].name}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{mine.w}-{mine.l} <span className="small muted" style={{ fontWeight: 400 }}>{mine.result || 'Missed the playoffs'}</span></div>
            <div className="small">
              {ourWins.length ? <>Awards: {ourWins.map((a, i) => <span key={i}>{i ? ', ' : ''}<PlayerLink league={league} pid={a.pid} /> ({a.lg} {a.award}{a.pos ? `, ${a.pos}` : ''})</span>)}</> : 'No award winners.'}
              {ourVotes.length > 0 && <> Also: {ourVotes.map((x, i) => <span key={i}>{i ? ', ' : ''}<PlayerLink league={league} pid={x.r.pid} /> {ord(x.place)} in {x.v.lg} {x.v.award}</span>)}.</>}
            </div>
          </div>
        )}
        <div className="box" style={{ flex: '1 1 220px' }}>
          <div className="muted small">Best records</div>
          {(['AL', 'NL'] as const).map((lg) => { const b = best(lg); return b ? <div key={lg} className="small" style={{ marginTop: 4 }}><b>{lg}:</b> <TeamBadge league={league} orgId={b.orgId} size={18} /> {league.orgs[b.orgId].abbrev} {b.w}-{b.l}</div> : null; })}
        </div>
      </div>

      {VOTED.map((aw) => {
        const vs = votes.filter((v) => v.award === aw);
        if (!vs.length) {
          // Seasons before ballots were kept: winners only.
          const ws = awards.filter((a) => a.award === aw);
          if (!ws.length) return null;
          return (
            <div key={aw}><h2>{aw}</h2><p className="small">{ws.map((a, i) => <span key={i}>{i ? ' · ' : ''}<b>{a.lg}:</b> <PlayerLink league={league} pid={a.pid} /> ({league.orgs[a.orgId].abbrev}, {a.line})</span>)}</p></div>
          );
        }
        return (
          <div key={aw}>
            <h2>{aw}</h2>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {(['AL', 'NL'] as const).map((lg) => { const v = vs.find((x) => x.lg === lg); return v ? <VoteTable key={lg} league={league} v={v} /> : null; })}
            </div>
          </div>
        );
      })}

      {(['Silver Slugger', 'Gold Glove'] as AwardName[]).map((aw) => (
        <div key={aw}>
          <h2>{aw}s</h2>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {(['AL', 'NL'] as const).map((lg) => (
              <div key={lg} className="box" style={{ flex: '1 1 460px' }}>
                <div className="muted small">{lg}</div>
                <div style={{ overflowX: 'auto' }}><table className="data compact"><tbody>
                  {awards.filter((a) => a.award === aw && a.lg === lg).map((a, i) => (
                    <tr key={i} className={a.orgId === league.userOrgId ? 'user' : ''}><td className="l" style={{ width: 36 }}>{a.pos}</td><td className="l nowrap"><PlayerLink league={league} pid={a.pid} /></td><td>{league.orgs[a.orgId].abbrev}</td><td className="l small">{a.line}</td></tr>
                  ))}
                </tbody></table></div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="small muted">Voting: 30 writers per league. MVP ballots have ten places (14-9-8-7-6-5-4-3-2-1 points), Cy Young five (7-4-3-2-1), Rookie of the Year and Reliever of the Year three (5-3-1). All-Stars are on the <a href={href('awards')}>Awards</a> page.</p>
    </>
  );
}
