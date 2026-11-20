// Compact ratings card used beside the depth chart.
import type { BatSplit, FieldPos, League, Level, Player } from '../core/types.ts';
import { FIELD_POS } from '../core/types.ts';
import { contact, isPitcher, posRating, scout, scoutedOvr, scoutedPot } from '../core/ratings.ts';
import { posLabel } from '../core/rules.ts';
import { href } from '../router.ts';
import { Rating } from './components.tsx';
import { avg, era, fip, fmt3, ipStr, obp, seasonBat, seasonPit, slg, whip } from './fmt.tsx';

const BAT_ROWS: [string, keyof BatSplit | 'contact'][] = [
  ['Hit tool', 'contact'],
  ['Hit quality', 'babip'],
  ['Bat-to-ball', 'avoidK'],
  ['Gap power', 'gap'],
  ['Power', 'power'],
  ['Eye', 'eye'],
];
const val = (s: BatSplit, k: keyof BatSplit | 'contact') => (k === 'contact' ? contact(s) : s[k]);

export function PlayerCard({ league, p, level }: { league: League; p: Player; level: Level }) {
  // Same scouting keys as the player page, so the numbers match.
  const R = ({ k, v, pot }: { k: string; v: number; pot?: boolean }) => <Rating v={scout(league, p, k, v, pot)} />;
  const season = league.season;
  return (
    <div className="box">
      <h3 style={{ marginTop: 0 }}>
        <a href={href('player', [p.id])}>{p.first} {p.last}</a>{' '}
        <span className="muted small">{posLabel(p)}, {season - p.born}, {isPitcher(p) ? `throws ${p.throws}` : `bats ${p.bats}`}</span>
      </h3>
      <div className="small">
        Ovr <Rating v={scoutedOvr(league, p)} /> / Pot <Rating v={scoutedPot(league, p)} />
        {p.injury && <span className="tag tag-il">{p.injury.name}, {p.injury.daysLeft}d</span>}
      </div>
      {isPitcher(p) ? (
        <>
          <table className="data compact">
            <thead><tr><th className="l">Pitching</th><th>Now</th><th>Pot</th></tr></thead>
            <tbody>
              <tr><td className="l">Stuff</td><td><R k="stuff" v={p.ratings.pit.stuff} /></td><td><R k="pstuff" v={p.pot.stuff} pot /></td></tr>
              <tr><td className="l">Movement</td><td><R k="mov" v={p.ratings.pit.movement} /></td><td><R k="pmov" v={p.pot.movement} pot /></td></tr>
              <tr><td className="l">Control</td><td><R k="ctl" v={p.ratings.pit.control} /></td><td><R k="pctl" v={p.pot.control} pot /></td></tr>
              <tr><td className="l">Stamina</td><td><R k="stam" v={p.ratings.pit.stamina} /></td><td><R k="pstam" v={p.pot.stamina} pot /></td></tr>
            </tbody>
          </table>
          {(() => {
            const s = seasonPit(p, season, level);
            return s.outs ? <p className="small">{season}: {s.w}-{s.l}, {era(s).toFixed(2)} ERA, {ipStr(s.outs)} IP, {s.k} K, {whip(s).toFixed(2)} WHIP, {fip(s).toFixed(2)} FIP</p> : <p className="muted small">No {level} innings this season.</p>;
          })()}
        </>
      ) : (
        <>
          <table className="data compact">
            <thead><tr><th className="l">Batting</th><th>vL</th><th>vR</th><th>Pot</th></tr></thead>
            <tbody>
              {BAT_ROWS.map(([label, k]) => (
                <tr key={k}>
                  <td className="l">{label}</td>
                  <td><R k={`vL-${k}`} v={val(p.ratings.vL, k)} /></td>
                  <td><R k={`vR-${k}`} v={val(p.ratings.vR, k)} /></td>
                  <td><R k={`pot-${k}`} v={val(p.pot.bat, k)} pot /></td>
                </tr>
              ))}
              <tr><td className="l">Speed</td><td colSpan={2}><R k="spd" v={p.ratings.run.speed} /></td><td /></tr>
            </tbody>
          </table>
          <table className="data compact">
            <thead><tr>{FIELD_POS.map((pos: FieldPos) => <th key={pos}>{pos}</th>)}</tr></thead>
            <tbody><tr>{FIELD_POS.map((pos: FieldPos) => <td key={pos}><R k={`pos-${pos}`} v={posRating(p.ratings.def, pos)} /></td>)}</tr></tbody>
          </table>
          {(() => {
            const b = seasonBat(p, season, level);
            return b.pa ? <p className="small">{season}: {fmt3(avg(b))}/{fmt3(obp(b))}/{fmt3(slg(b))}, {b.hr} HR, {b.sb} SB in {b.pa} PA</p> : <p className="muted small">No {level} plate appearances this season.</p>;
          })()}
        </>
      )}
      <a className="small" href={href('player', [p.id])}>Full player page</a>
    </div>
  );
}
