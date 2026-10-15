// The event log: per connection mode, the recent record of what happened in the background (errors a mode client
// reports through `onError`, health changes), kept in memory and pushed live to subscribers.
import type { EventLogEntry, Mode } from '@showcase/contracts';

export type NewEntry = Omit<EventLogEntry, 'id' | 'ts' | 'mode'>;

export interface EventLog {
  append(mode: Mode, entry: NewEntry): EventLogEntry;
  /** Every buffered entry, all modes, oldest first. */
  entries(): EventLogEntry[];
  /** Calls `listener` with each new entry until the returned function is called. */
  subscribe(listener: (entry: EventLogEntry) => void): () => void;
}

const ENTRIES_PER_MODE = 300;

export function createEventLog(): EventLog {
  const buffers = new Map<Mode, EventLogEntry[]>();
  const listeners = new Set<(entry: EventLogEntry) => void>();
  let nextId = 0;

  return {
    append(mode, entry) {
      const full = { ...entry, id: ++nextId, ts: Date.now(), mode };
      const buffer = buffers.get(mode) ?? [];
      buffer.push(full);
      if (buffer.length > ENTRIES_PER_MODE) buffer.shift();
      buffers.set(mode, buffer);
      for (const listener of listeners) listener(full);
      return full;
    },
    entries: () => [...buffers.values()].flat().sort((a, b) => a.id - b.id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
