// The current time, re-rendering every `stepMs`: for countdowns to a time the backend returned.
'use client';

import { useEffect, useState } from 'react';

export function useNow(stepMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(timer);
  }, [stepMs]);
  return now;
}
