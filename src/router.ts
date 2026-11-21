// Minimal hash router: #/page/arg?key=value
import { useSyncExternalStore } from 'react';

export interface Route {
  page: string;
  args: string[];
  query: Record<string, string>;
}

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query: Record<string, string> = {};
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  return { page: parts[0] ?? '', args: parts.slice(1), query };
}

let current = parse();
const subs = new Set<() => void>();
// Scroll memory: Back/Forward returns you to where you were on that page;
// following a link or go() starts the new page at the top.
const scrolls = new Map<string, number>();
let lastHash = window.location.hash;
let linkNav = false;
window.addEventListener('scroll', () => scrolls.set(lastHash, window.scrollY), { passive: true });
document.addEventListener('click', (e) => {
  if ((e.target as Element | null)?.closest?.('a[href^="#"]')) linkNav = true;
}, true);
function restore(y: number, tries = 20): void {
  requestAnimationFrame(() => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) > 2 && tries > 0) restore(y, tries - 1); // page still rendering
  });
}
window.addEventListener('hashchange', () => {
  const prev = current;
  const fromLink = linkNav;
  linkNav = false;
  lastHash = window.location.hash;
  current = parse();
  for (const s of subs) s();
  // Same page with a different tab/filter: stay put.
  if (prev.page === current.page && prev.args.join('/') === current.args.join('/')) return;
  const saved = scrolls.get(lastHash);
  if (!fromLink && saved) restore(saved);
  else window.scrollTo(0, 0);
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}

export function href(page: string, args: (string | number)[] = [], query: Record<string, string | number | undefined> = {}): string {
  const q = Object.entries(query).filter(([, v]) => v !== undefined && v !== '');
  const qs = q.length ? `?${q.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
  return `#/${[page, ...args.map(String)].map(encodeURIComponent).join('/')}${qs}`;
}

export function go(page: string, args: (string | number)[] = [], query: Record<string, string | number | undefined> = {}): void {
  linkNav = true;
  window.location.hash = href(page, args, query);
}
