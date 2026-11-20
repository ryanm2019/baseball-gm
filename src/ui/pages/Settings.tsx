import { useStore, changed, setLeague, setMessage } from '../../store.ts';
import { askConfirm } from '../../store.ts';
import type { Level, Settings } from '../../core/types.ts';
import { LEVELS } from '../../core/types.ts';
import { deleteLeague } from '../../db.ts';
import { go } from '../../router.ts';

type NumKey = { [K in keyof Settings]-?: Settings[K] extends number ? K : never }[keyof Settings];

const GROUPS: { title: string; fields: [NumKey, string, string?][] }[] = [
  {
    title: 'Rosters',
    fields: [
      ['activeMax', 'Active roster max'],
      ['activeMaxSept', 'Active roster max (September)'],
      ['pitcherMax', 'Pitcher limit'],
      ['pitcherMaxSept', 'Pitcher limit (September)'],
      ['fortyMax', '40-man roster size'],
      ['septemberDay', 'Roster expansion day', 'Days after Opening Day'],
      ['tradeDeadlineDay', 'Trade deadline', 'Days after Opening Day'],
      ['postseasonEligibilityDay', 'Postseason roster eligibility cutoff', 'Days after Opening Day'],
      ['draftDay', 'Amateur draft', 'Days after Opening Day'],
    ],
  },
  {
    title: 'Options, waivers & service time',
    fields: [
      ['optionYears', 'Option years'],
      ['optionDaysToUseYear', 'Days optioned that use an option year'],
      ['maxOptionsPerSeason', 'Max times optioned per season'],
      ['optionMinStayPitcher', 'Min stay after option, pitchers (days)'],
      ['optionMinStayPosition', 'Min stay after option, position players (days)'],
      ['optionConsentServiceYears', 'Service years to refuse an option'],
      ['outrightRefuseServiceYears', 'Service years to refuse an outright'],
      ['serviceDaysPerYear', 'Days per service year'],
      ['dfaDays', 'DFA period (days)'],
      ['waiverDays', 'Waiver period (days)'],
      ['il10Days', 'Short IL, position players (days)'],
      ['il15Days', 'Short IL, pitchers (days)'],
      ['il60Days', 'Long IL (days)'],
    ],
  },
  {
    title: 'Money',
    fields: [
      ['minSalary', 'MLB minimum salary ($)'],
      ['minorSalaryFirstML', 'Minor league salary, first ML contract ($)'],
      ['minorSalarySecondML', 'Minor league salary, later ML contracts ($)'],
      ['cbtThreshold', 'CBT threshold ($)'],
      ['cbtTierStep', 'CBT surcharge tier size ($)'],
      ['playerBenefits', 'Player benefits counted toward CBT ($)'],
    ],
  },
  {
    title: 'Gameplay',
    fields: [['injuryRate', 'Injury rate multiplier']],
  },
];

export default function SettingsPage() {
  const { league } = useStore();
  if (!league) return null;
  const s = league.settings;
  const setNum = (k: NumKey, v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    (s[k] as number) = n;
    changed();
  };
  const exportLeague = () => {
    const blob = new Blob([JSON.stringify(league)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${league.name.replace(/\W+/g, '_')}_${league.season}_day${league.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  return (
    <>
      <h1>League Settings</h1>
      <p className="muted small">Defaults follow MLB rules for the 2026 season. Changes apply from the next day you play.</p>
      <h2>General</h2>
      <p className="muted small">Which roster jobs the assistant GM handles for you is set on the <a href="#/staff">Staff</a> page.</p>
      <div className="form-row">
        <label>
          <input type="checkbox" checked={s.extraInningRunner} onChange={(e) => { s.extraInningRunner = e.target.checked; changed(); }} /> Automatic runner on second in extra innings
        </label>
      </div>
      <div className="form-row">
        <label>
          <input type="checkbox" checked={s.allowFiring} onChange={(e) => { s.allowFiring = e.target.checked; changed(); }} /> You can be fired
        </label>{' '}
        <span className="muted small">Off: the owner still sets goals and checks in, but job security never drops low enough to fire you.</span>
      </div>
      <div className="form-row">
        <label>
          Storylines{' '}
          <select value={s.storylines ?? 'normal'} onChange={(e) => { s.storylines = e.target.value as Settings['storylines']; changed(); }}>
            <option value="off">Off</option><option value="rare">Rare</option><option value="normal">Normal</option><option value="frequent">Frequent</option>
          </select>
        </label>{' '}
        <label>
          <input type="checkbox" checked={s.careerEndingStories ?? true} onChange={(e) => { s.careerEndingStories = e.target.checked; changed(); }} /> Career-ending storylines
        </label>{' '}
        <span className="muted small">Breakouts, new pitches, slumps, freak injuries, suspensions, clubhouse fights and more. Career-ending stories can retire a player (even a top prospect).</span>
      </div>
      <div className="form-row">
        Trade AI difficulty{' '}
        <select value={s.tradeDifficulty} onChange={(e) => { s.tradeDifficulty = e.target.value as Settings['tradeDifficulty']; changed(); }}>
          {['Easy', 'Normal', 'Hard', 'Insane'].map((x) => <option key={x}>{x}</option>)}
        </select>
        AI-to-AI trade frequency{' '}
        <input type="number" step="0.25" min={0} max={3} value={s.aiTradeFactor} onChange={(e) => { s.aiTradeFactor = Math.max(0, Number(e.target.value)); changed(); }} />
        <span className="muted small">0 = off, 1 = realistic (busiest before the deadline and over the winter)</span>
      </div>
      <div className="form-row">
        Scouting fog{' '}
        <select value={s.scoutingAccuracy} onChange={(e) => { s.scoutingAccuracy = e.target.value as Settings['scoutingAccuracy']; changed(); }}>
          {['Low', 'Normal', 'High', 'Perfect'].map((x) => <option key={x}>{x}</option>)}
        </select>
        Rating increments{' '}
        <select value={s.ratingIncrement} onChange={(e) => { s.ratingIncrement = Number(e.target.value) as 1 | 5; changed(); }}>
          <option value={5}>5 (20, 25, 30…)</option>
          <option value={1}>1</option>
        </select>
      </div>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h2>{g.title}</h2>
          <table className="data compact" style={{ minWidth: 0 }}>
            <tbody>
              {g.fields.map(([k, label, note]) => (
                <tr key={k}>
                  <td className="l">{label}{note && <span className="muted small"> ({note})</span>}</td>
                  <td><input type="number" value={s[k] as number} onChange={(e) => setNum(k, e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <h2>CBT rates</h2>
      <div className="form-row">
        Base rate by consecutive payer year:
        {s.cbtBaseRates.map((r, i) => (
          <input key={i} type="number" step="0.01" value={r} onChange={(e) => { s.cbtBaseRates[i] = Number(e.target.value); changed(); }} />
        ))}
      </div>
      <div className="form-row">
        Surcharges for tiers 2, 3, 4:
        {s.cbtSurcharges.map((r, i) => (
          <input key={i} type="number" step="0.005" value={r} onChange={(e) => { s.cbtSurcharges[i] = Number(e.target.value); changed(); }} />
        ))}
      </div>
      <h2>Minor league active roster limits</h2>
      <table className="data compact" style={{ minWidth: 0 }}>
        <tbody>
          {LEVELS.filter((l) => l !== 'MLB').map((l: Level) => (
            <tr key={l}>
              <td className="l">{l}</td>
              <td><input type="number" value={s.milbActiveMax[l]} onChange={(e) => { s.milbActiveMax[l] = Number(e.target.value); changed(); }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Season lengths and start dates are fixed for this season once the schedule is made.</p>
      <h2>League file</h2>
      <div className="form-row">
        <button className="btn" onClick={exportLeague}>Download league (JSON)</button>
        <button
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(JSON.stringify(league));
              setMessage('League JSON copied to the clipboard. Paste it into a .json file to keep a backup.');
            } catch {
              setMessage('Copying was blocked here. Try Download instead.');
            }
          }}
        >
          Copy league JSON
        </button>
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!(await askConfirm(`Delete ${league.name}? This cannot be undone.`))) return;
            await deleteLeague(league.id);
            setLeague(null);
            go('');
          }}
        >
          Delete league
        </button>
      </div>
    </>
  );
}
