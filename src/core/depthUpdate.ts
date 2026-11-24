// When a new player joins a club whose depth chart is set by hand, slot him in
// where he's an upgrade (otherwise he'd sit on the bench until you noticed).
import type { League, Org, Player, Pos } from './types.ts';
import { isPitcher, ovr } from './ratings.ts';
import { ovrAt } from './positions.ts';
import { pname } from './util.ts';

export function slotNewcomer(league: League, org: Org, p: Player): string | null {
  const d = org.depth.MLB;
  if (!d || d.auto || p.level !== 'MLB' || p.orgId !== org.id || p.injury) return null;
  if (isPitcher(p)) {
    if (p.pos !== 'SP' || !d.rotation.length || d.rotation.includes(p.id)) return null;
    const rot = d.rotation.map((id) => league.players[id]).filter((q): q is Player => !!q);
    const worst = [...rot].sort((a, b) => ovr(a) - ovr(b))[0];
    if (!worst || ovr(p) <= ovr(worst) + 1) return null;
    d.rotation = d.rotation.map((id) => (id === worst.id ? p.id : id));
    return `He takes ${pname(worst)}'s spot in your rotation.`;
  }
  let text: string | null = null;
  for (const card of [d.lineup, d.lineupL]) {
    if (!card || card.some((s) => s.pid === p.id)) continue;
    // His own position, or DH: wherever he's the bigger upgrade.
    let best: { i: number; gain: number } | null = null;
    card.forEach((s, i) => {
      if (s.pos !== p.pos && s.pos !== 'DH') return;
      const cur = league.players[s.pid];
      const gain = ovrAt(p, s.pos as Pos) - (cur && cur.orgId === org.id && cur.level === 'MLB' && !cur.injury ? ovrAt(cur, s.pos as Pos) : 0);
      if (gain >= 1 && (!best || gain > best.gain)) best = { i, gain };
    });
    if (!best) continue;
    const slot = card[(best as { i: number }).i];
    const was = league.players[slot.pid];
    slot.pid = p.id;
    if (!text) text = `He's in your lineup at ${slot.pos}${was ? ` in place of ${pname(was)}` : ''}.`;
  }
  return text;
}
