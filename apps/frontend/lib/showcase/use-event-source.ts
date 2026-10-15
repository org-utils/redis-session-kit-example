// A small hook over EventSource. The browser reconnects on its own after an error; `onOpen` fires on every (re)connect.
'use client';

import { useEffect, useRef, useState } from 'react';

export type StreamState = 'connecting' | 'open' | 'lost';

export function useEventSource(url: string, handlers: { onOpen?: () => void; onMessage: (data: string) => void }) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const [state, setState] = useState<StreamState>('connecting');

  useEffect(() => {
    const source = new EventSource(url);
    source.onopen = () => {
      setState('open');
      latest.current.onOpen?.();
    };
    source.onerror = () => setState('lost');
    source.onmessage = (event) => latest.current.onMessage(event.data);
    return () => source.close();
  }, [url]);

  return state;
}
