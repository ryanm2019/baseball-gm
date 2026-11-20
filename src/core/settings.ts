import type { Level, Settings } from './types.ts';

// Defaults follow MLB rules as of the 2026 season. Every value is editable in League Settings.
export function defaultSettings(): Settings {
  return {
    gamesPerSeason: { MLB: 162, AAA: 150, AA: 138, 'A+': 132, A: 132, CPX: 56, DSL: 60 },
    // Day 0 = MLB Opening Day. Complex leagues and the DSL start in June.
    levelStartDay: { MLB: 0, AAA: 0, AA: 7, 'A+': 7, A: 7, CPX: 70, DSL: 66 },
    seasonDays: 186,
    septemberDay: 159,

    activeMax: 26,
    activeMaxSept: 28,
    pitcherMax: 13,
    pitcherMaxSept: 14,
    fortyMax: 40,
    milbActiveMax: { MLB: 26, AAA: 28, AA: 28, 'A+': 30, A: 30, CPX: 35, DSL: 35 },

    optionYears: 3,
    optionDaysToUseYear: 20,
    maxOptionsPerSeason: 5,
    optionMinStayPitcher: 15,
    optionMinStayPosition: 10,
    serviceDaysPerYear: 172,
    optionConsentServiceYears: 5,
    outrightRefuseServiceYears: 3,
    dfaDays: 7,
    waiverDays: 2,
    il10Days: 10,
    il15Days: 15,
    il60Days: 60,

    minSalary: 780_000,
    minorSalaryFirstML: 62_500,
    minorSalarySecondML: 125_000,
    cbtThreshold: 244_000_000,
    cbtTierStep: 20_000_000,
    cbtBaseRates: [0.2, 0.3, 0.5],
    cbtSurcharges: [0.12, 0.425, 0.6],
    playerBenefits: 17_000_000,

    scoutingAccuracy: 'Normal',
    ratingIncrement: 5,
    injuryRate: 1,
    draftDay: 108,
    draftSigningDays: 22,
    draftRounds: 20,
    extraInningRunner: true,
  };
}

export const LEVEL_NAMES: Record<Level, string> = {
  MLB: 'MLB',
  AAA: 'Triple-A',
  AA: 'Double-A',
  'A+': 'High-A',
  A: 'Single-A',
  CPX: 'Complex',
  DSL: 'Dominican Summer',
};

// Typical true-talent overall (20-80) of a player at each level, used for
// generation and farm director decisions.
export const LEVEL_TALENT: Record<Level, number> = {
  MLB: 50,
  AAA: 42,
  AA: 39,
  'A+': 35.5,
  A: 32.5,
  CPX: 29,
  DSL: 27,
};

export const LEVEL_AGE: Record<Level, number> = {
  MLB: 29,
  AAA: 26.5,
  AA: 24,
  'A+': 22.5,
  A: 21,
  CPX: 19.5,
  DSL: 17.5,
};

export const OPENING_DAY = { month: 2, date: 26 }; // March 26 (month is 0-based)

export function dayToDate(season: number, day: number): Date {
  const d = new Date(Date.UTC(season, OPENING_DAY.month, OPENING_DAY.date));
  d.setUTCDate(d.getUTCDate() + day);
  return d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayLabel(season: number, day: number): string {
  const d = dayToDate(season, day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function dayShort(season: number, day: number): string {
  const d = dayToDate(season, day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
