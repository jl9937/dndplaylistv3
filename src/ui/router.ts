import { useEffect, useState } from 'react';

// Hash routing (spec §7): no server-side fallback needed, and ?debug in the query survives.
export type Route = 'board' | 'library';

function parse(): Route | null {
  const h = location.hash.replace(/^#\/?/, '');
  return h === 'board' || h === 'library' ? h : null;
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
