import { useEffect, useState } from 'react';
import { setFloating } from '../playback/nowPlaying';
import { dockToRight, openFloat, restoreWindow } from './compact';

/** Compact (docked) and floating (Picture-in-Picture) strip modes, spec §13.5. */
export function useStripMode(onError: (message: string) => void) {
  const [compact, setCompact] = useState(false);
  const [pip, setPip] = useState<Window | null>(null);

  const enterCompact = () => {
    setCompact(true);
    dockToRight();
  };
  const exitCompact = () => {
    setCompact(false);
    restoreWindow();
  };

  const float = async () => {
    try {
      const w = await openFloat();
      w.addEventListener('pagehide', () => {
        setPip(null);
        setFloating(false);
      });
      setPip(w);
      setFloating(true);
      if (compact) exitCompact();
    } catch (e) {
      onError(`Couldn’t open the floating strip: ${e instanceof Error ? e.message : e}`);
    }
  };

  // Closing the app closes the floating strip too.
  useEffect(() => () => pip?.close(), [pip]);

  return { compact, pip, enterCompact, exitCompact, float };
}
