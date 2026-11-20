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
window.addEventListener('hashchange', () => {
  current = parse();
  for (const s of subs) s();
  window.scrollTo(0, 0);
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
  window.location.hash = href(page, args, query);
}
