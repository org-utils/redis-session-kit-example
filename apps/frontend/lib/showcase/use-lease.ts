// The lock pane's view of one lease, polled from GET /api/:mode/lock/lease: the token stored in the key and its PTTL,
// as Redis holds them (native GET + PTTL, not a package call).
'use client';

import { LockLeaseSchema, type LockLease, type Mode } from '@showcase/contracts';
import { useEffect, useState } from 'react';

const POLL_MS = 250;

/** The lease, or null until the first answer (and while the backend can't be reached). */
export function useLease(mode: Mode, name: string): LockLease | null {
  const [lease, setLease] = useState<LockLease | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/${mode}/lock/lease?${new URLSearchParams({ name })}`);
        const next = res.ok ? LockLeaseSchema.parse(await res.json()) : null;
        if (!stopped) setLease(next);
      } catch {
        if (!stopped) setLease(null);
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    setLease(null);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [mode, name]);
  return lease;
}
