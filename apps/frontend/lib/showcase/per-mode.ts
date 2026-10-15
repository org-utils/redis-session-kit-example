// State a section keeps separately for each connection mode (tokens, a window, cards…), so switching modes and back
// finds it as it was.
import { MODES, type Mode } from '@showcase/contracts';

export const perMode = <T>(make: () => T) => Object.fromEntries(MODES.map((m) => [m, make()])) as Record<Mode, T>;
