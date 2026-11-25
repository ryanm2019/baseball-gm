// Broadcast-style building blocks (MLB The Show look): grade colors, the OVR
// badge, rating bars and the big player header used on the depth chart and
// the player page.
import type { ReactNode } from 'react';
import type { BatSplit, League, Level, Player, PitchType } from '../core/types.ts';
import { contact, isPitcher, posRating, scout, scoutedOvr, scoutedPot } from '../core/ratings.ts';
import { posLabel } from '../core/rules.ts';
import { href } from '../router.ts';
import { heat } from '../core/form.ts';
import { avg, era, fmt3, ipStr, obp, seasonBat, seasonPit, slg, whip } from './fmt.tsx';

import { gradeClass } from './components.tsx';
export { gradeClass };

export function OvrBadge({ v, label = 'OVR', small }: { v: number; label?: string; small?: boolean }) {
  return (
    <div className={`ovr-badge ${gradeClass(v)}${small ? ' sm' : ''}`}>
      <b>{v}</b>
      <span>{label}</span>
    </div>
  );
}

export function Bar({ label, v, note }: { label: string; v: number; note?: string }) {
  return (
    <div className="sbar">
      <div className="sbar-top"><span>{label}{note && <i> {note}</i>}</span><b>{v}</b></div>
      <div className="sbar-track"><div className={`sbar-fill ${gradeClass(v)}`} style={{ width: `${Math.max(4, Math.min(100, ((v - 20) / 60) * 100))}%` }} /></div>
    </div>
  );
}

export const PITCH_NAMES: Record<string, string> = { FB: '4-Seam', SI: 'Sinker', CT: 'Cutter', SL: 'Slider', SW: 'Sweeper', CB: 'Curveball', CH: 'Changeup', SP: 'Splitter', KN: 'Knuckleball' };

const armKey = (p: Player) => (p.pos === 'C' ? 'cArm' : ['LF', 'CF', 'RF'].includes(p.pos) ? 'ofArm' : 'ifArm') as 'cArm' | 'ofArm' | 'ifArm';

// The rating bars for a player, scouted the same way as everywhere else.
export function ratingBars(league: League, p: Player): { label: string; v: number; note?: string }[] {
  const s = (k: string, v: number) => scout(league, p, k, v);
  if (isPitcher(p)) {
    const r = p.ratings.pit;
    const out: { label: string; v: number; note?: string }[] = [
      { label: 'Stuff', v: s('stuff', r.stuff) },
      { label: 'Movement', v: s('mov', r.movement) },
      { label: 'Control', v: s('ctl', r.control) },
      { label: 'Stamina', v: s('stam', r.stamina) },
    ];
    const pitches = (Object.entries(r.pitches) as [PitchType, number][]).sort((a, b) => b[1] - a[1]);
    for (const [pt, v] of pitches) out.push({ label: PITCH_NAMES[pt] ?? pt, v: s(`pitch-${pt}`, v ?? 20), note: pt === 'FB' || pt === 'SI' ? `${Math.round(r.velo)} mph` : undefined });
    return out;
  }
  const c = (sp: BatSplit) => contact(sp);
  const fieldPos = p.pos === 'DH' || p.pos === 'SP' || p.pos === 'RP' ? null : p.pos;
  return [
    { label: 'Contact vL', v: s('vL-contact', c(p.ratings.vL)) },
    { label: 'Contact vR', v: s('vR-contact', c(p.ratings.vR)) },
    { label: 'Power vL', v: s('vL-power', p.ratings.vL.power) },
    { label: 'Power vR', v: s('vR-power', p.ratings.vR.power) },
    { label: 'Eye', v: s('vR-eye', p.ratings.vR.eye) },
    { label: 'Speed', v: s('spd', p.ratings.run.speed) },
    ...(fieldPos ? [{ label: `Defense (${fieldPos})`, v: s(`pos-${fieldPos}`, posRating(p.ratings.def, fieldPos)) }, { label: 'Arm', v: s(`def-${armKey(p)}`, p.ratings.def[armKey(p)]) }] : []),
  ];
}

// Big numbers under the name: this season (or last, over the winter).
export function headlineStats(league: League, p: Player, level?: Level): { label: string; value: string }[] {
  const season = league.phase === 'preseason' ? league.season - 1 : league.season;
  if (isPitcher(p)) {
    const s = seasonPit(p, season, level);
    if (!s.outs) return [];
    return [
      { label: 'Win-Loss', value: `${s.w}-${s.l}` },
      { label: p.pos === 'RP' ? 'Saves' : 'IP', value: p.pos === 'RP' ? String(s.sv) : ipStr(s.outs) },
      { label: 'SO', value: String(s.k) },
      { label: 'ERA', value: era(s).toFixed(2) },
      { label: 'WHIP', value: whip(s).toFixed(2) },
    ];
  }
  const b = seasonBat(p, season, level);
  if (!b.pa) return [];
  return [
    { label: 'AVG', value: fmt3(avg(b)) },
    { label: 'HR', value: String(b.hr) },
    { label: 'RBI', value: String(b.rbi) },
    { label: 'OBP', value: fmt3(obp(b)) },
    { label: 'OPS', value: fmt3(obp(b) + slg(b)) },
  ];
}

export function ShowHeader({ league, p, level, children }: { league: League; p: Player; level?: Level; children?: ReactNode }) {
  const stats = headlineStats(league, p, level);
  const bars = ratingBars(league, p);
  const season = league.phase === 'preseason' ? league.season - 1 : league.season;
  const org = p.orgId !== null ? league.orgs[p.orgId] : null;
  return (
    <div className="show-header">
      <div className="sh-left">
        <div className="sh-first">{p.first}</div>
        <div className="sh-last"><a href={href('player', [p.id])}>{p.last}</a></div>
        <div className="sh-meta">
          <span className="sh-age">{league.season - p.born}</span>
          <span className="pos-diamond"><i>{posLabel(p)}</i></span>
          <span className="sh-chip">{isPitcher(p) ? `Throws ${p.throws}` : `Bats ${p.bats}`}</span>
          {org && <span className="sh-chip">{org.abbrev}</span>}
          {(() => { const h = heat(league, p); return h ? <span className={`sh-chip heat-chip ${h.kind}`} title={h.text}>{h.kind === 'hot' ? '🔥 Hot' : '❄️ Cold'}</span> : null; })()}
          {p.injury && <span className="sh-chip bad">{p.injury.name}, {p.injury.daysLeft}d</span>}
          {children}
        </div>
        {stats.length ? (
          <div className="sh-stats">
            {stats.map((x) => <div key={x.label}><b>{x.value}</b><span>{x.label}</span></div>)}
            <div className="sh-season">{season}{level ? ` · ${level}` : ''}</div>
          </div>
        ) : <div className="sh-season">No {season} stats{level ? ` at ${level}` : ''} yet</div>}
      </div>
      <div className="sh-right">
        <div className="sh-badges">
          <OvrBadge v={scoutedOvr(league, p)} />
          <OvrBadge v={scoutedPot(league, p)} label="POT" small />
        </div>
        <div className="sh-bars">{bars.map((b) => <Bar key={b.label} {...b} />)}</div>
      </div>
    </div>
  );
}

// Fire / snowflake for a hot or cold stretch.
export function HeatIcon({ league, p }: { league: League; p: Player }) {
  const h = heat(league, p);
  if (!h) return null;
  return <span className={`heat ${h.kind}`} title={h.text} aria-label={h.kind}>{h.kind === 'hot' ? '🔥' : '❄️'}</span>;
}

// A fixed color per club (the fictional clubs have no official colors).
const TEAM_COLORS = ['#1d4ed8', '#b91c1c', '#047857', '#7c3aed', '#c2410c', '#0e7490', '#a16207', '#be185d', '#334155', '#15803d', '#9333ea', '#0369a1', '#dc2626', '#4d7c0f', '#1e40af', '#b45309', '#0f766e', '#6d28d9', '#991b1b', '#0284c7', '#65a30d', '#c026d3', '#1f2937', '#ea580c', '#2563eb', '#16a34a', '#e11d48', '#7e22ce', '#0891b2', '#854d0e'];
export const teamColor = (orgId: number): string => TEAM_COLORS[orgId % TEAM_COLORS.length];

export function TeamBadge({ league, orgId, size = 34 }: { league: League; orgId: number; size?: number }) {
  const o = league.orgs[orgId];
  return (
    <span className="team-badge" style={{ width: size, height: size, background: teamColor(orgId), fontSize: Math.round(size * 0.32) }} title={`${o.region} ${o.name}`}>
      {o.abbrev}
    </span>
  );
}
