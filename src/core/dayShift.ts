// League days count from Opening Day of the current season, so when the new
// season starts in February the day number jumps back about a year. Anything
// still pending (free agent decisions, waivers, trade answers, IL stints...)
// carries a day number that has to move with it.
import type { League } from './types.ts';

export function shiftPendingDays(league: League, delta: number, only?: (day: number) => boolean): void {
  const f = (d: number | undefined | null): number | undefined | null => (d === undefined || d === null || (only && !only(d)) ? d : d + delta);
  for (const p of Object.values(league.players)) {
    if (p.retired) continue;
    if (p.fa) {
      const fa = p.fa;
      fa.opened = f(fa.opened) as number;
      fa.decideDay = f(fa.decideDay) as number;
      for (const o of fa.offers) o.day = f(o.day) as number;
      for (const o of fa.milbOffers ?? []) o.day = f(o.day) as number;
      fa.milbDecide = f(fa.milbDecide) as number | undefined;
    }
    if (p.ifa) {
      if (p.ifa.verbal) p.ifa.verbal.day = f(p.ifa.verbal.day) as number;
      if (p.ifa.lastOffer) for (const k of Object.keys(p.ifa.lastOffer)) p.ifa.lastOffer[Number(k)] = f(p.ifa.lastOffer[Number(k)]) as number;
    }
    if (p.il) {
      p.il.since = f(p.il.since) as number;
      p.il.readyNoticeDay = f(p.il.readyNoticeDay) as number | undefined;
    }
    if (p.dfa) p.dfa.day = f(p.dfa.day) as number;
    if (p.waivers) p.waivers.day = f(p.waivers.day) as number;
  }
  for (const t of league.tradeTalks ?? []) {
    if (t.status !== 'waiting' && t.status !== 'countered') continue;
    t.sentDay = f(t.sentDay) as number;
    t.respondDay = f(t.respondDay) as number;
    t.counterExpires = f(t.counterExpires) as number | undefined;
    t.season = league.season;
  }
  for (const fl of league.tradeFloated ?? []) fl.day = f(fl.day) as number;
}
