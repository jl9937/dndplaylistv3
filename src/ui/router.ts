import { useEffect, useState } from 'react';

// Hash routing (spec §7): no server-side fallback needed, and ?debug in the query survives.
/** `spike` is the Milestone 5 coverage check: reachable by URL only, not in the nav. */
export type Route = 'board' | 'library' | 'ambience' | 'spike';
const ROUTES: Route[] = ['board', 'library', 'ambience', 'spike'];

function parse(): Route | null {
  const h = location.hash.replace(/^#\/?/, '');
  return ROUTES.find((r) => r === h) ?? null;
}

export function useRoute(fallback: Route): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route | null>(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [route ?? fallback, (r) => (location.hash = `#/${r}`)];
}
