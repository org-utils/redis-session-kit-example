// State a section keeps separately for each connection mode (tokens, a window, cards…), so switching modes and back
// finds it as it was.
import { MODES, type Mode } from '@showcase/contracts';
import { useState } from 'react';

export const perMode = <T>(make: () => T) => Object.fromEntries(MODES.map((m) => [m, make()])) as Record<Mode, T>;

/**
 * Calls `clear(mode)` for each mode whose count in `resets` moved since the last render: the shell bumps a mode's count
 * when Reset section deletes its keys, so a section starts that mode over and keeps the others.
 */
export function useOnReset(resets: Record<Mode, number>, clear: (mode: Mode) => void) {
  const [seen, setSeen] = useState(resets);
  if (seen !== resets) {
    setSeen(resets);
    for (const mode of MODES) if (seen[mode] !== resets[mode]) clear(mode);
  }
}
