// A live view read from the backend by polling one GET route (the lock's lease, the streams' pending table): native
// Redis reads beside the package, re-read every `intervalMs` and whenever `refresh` changes.
'use client';

import { useEffect, useState } from 'react';
import type { z } from 'zod';

/** The latest answer, or null until the first one (and while the backend can't be reached). */
export function usePolled<T>(url: string, schema: z.ZodType<T>, intervalMs: number, refresh: unknown = null): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(url);
        const next = res.ok ? schema.parse(await res.json()) : null;
        if (!stopped) setValue(next);
      } catch {
        if (!stopped) setValue(null);
      }
      if (!stopped) timer = setTimeout(poll, intervalMs);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [url, schema, intervalMs, refresh]);
  // A different URL is a different view: forget the old one's answer until the new one arrives.
  const [shownFor, setShownFor] = useState(url);
  if (shownFor !== url) {
    setShownFor(url);
    setValue(null);
  }
  return value;
}
