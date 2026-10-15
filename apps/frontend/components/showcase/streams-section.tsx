// The streams section: a follow pane of entries as they're added (one shared read loop per stream on the backend, over
// SSE) and a per-group table of delivered-but-unacked entries (native XPENDING) on top; the operation form below.
'use client';

import { Waves } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { runOperation, type RunResult } from '@/lib/showcase/api';
import { spec, type Values } from '@/lib/showcase/examples';
import { perMode, useOnReset } from '@/lib/showcase/per-mode';
import { useEventSource } from '@/lib/showcase/use-event-source';
import { usePolled } from '@/lib/showcase/use-polled';
import { StreamEntrySchema, StreamsFollowEventSchema, StreamsPendingSchema, type Mode, type StreamEntry } from '@showcase/contracts';
import { OpForm } from './op-form';

const ENTRIES_SHOWN = 10;
const IDS_KEPT = 30;
const PENDING_POLL_MS = 1000;

/** The follow pane: entries the stream's shared read loop delivered since this browser joined it. */
function useFollow(mode: Mode, stream: string) {
  const [state, setState] = useState<{ loop: number | null; listeners: number; entries: StreamEntry[]; error?: string }>({ loop: null, listeners: 0, entries: [] });
  const connection = useEventSource(`/api/${mode}/streams/${encodeURIComponent(stream)}/follow`, {
    // A (re)connect joins a loop reading from now on: what was shown before is not part of it.
    onOpen: () => setState({ loop: null, listeners: 0, entries: [] }),
    onMessage(data) {
      const parsed = StreamsFollowEventSchema.safeParse(JSON.parse(data));
      if (!parsed.success) return;
      const event = parsed.data;
      setState((s) => {
        switch (event.type) {
          case 'following': return { ...s, loop: event.loop, listeners: event.listeners, error: undefined };
          case 'listeners': return { ...s, listeners: event.listeners };
          case 'entries': return { ...s, entries: [...s.entries, ...event.entries].slice(-ENTRIES_SHOWN), error: undefined };
          case 'error': return { ...s, error: event.message };
        }
      });
    },
  });
  const clear = () => setState((s) => ({ ...s, entries: [] }));
  return { ...state, connection, clear };
}

export function StreamsSection({ mode, resets, onResult }: { mode: Mode; resets: Record<Mode, number>; onResult: (r: RunResult) => void }) {
  // The stream both panes watch: the one the last operation ran on.
  const [stream, setStream] = useState('orders');
  const [refresh, setRefresh] = useState(0);
  const follow = useFollow(mode, stream);
  const pending = usePolled(`/api/${mode}/streams/pending?${new URLSearchParams({ stream })}`, StreamsPendingSchema, PENDING_POLL_MS, refresh);
  // Ids this browser has read, per mode: the last read's, and every one so far (newest first) with who read it.
  const [read, setRead] = useState(() => perMode<{ last: string[]; all: { id: string; by: string }[] }>(() => ({ last: [], all: [] })));
  const ids = read[mode];
  // Reset section deleted this mode's streams: what was read and followed there is gone.
  useOnReset(resets, (m) => {
    setRead((s) => ({ ...s, [m]: { last: [], all: [] } }));
    if (m === mode) follow.clear();
  });

  const pendingIds = new Set(pending?.groups.flatMap((g) => g.consumers.flatMap((c) => c.pending.map((p) => p.id))) ?? []);
  const run = async (op: string, v: Values): Promise<RunResult> => {
    const at = mode;
    setStream(String(v.stream));
    const values = v.ids === '$last' ? { ...v, ids: ids.last.join(',') } : v;
    const r = await runOperation(at, 'streams', op, () => spec('streams', op).body!(values));
    const entries = StreamEntrySchema.array().safeParse(r.body);
    if (op === 'read' && r.httpStatus === 200 && entries.success && entries.data.length) {
      const got = entries.data.map((e) => e.id);
      const by = v.group === '' ? 'plain read' : String(v.consumer);
      setRead((s) => ({ ...s, [at]: { last: got, all: [...got.map((id) => ({ id, by })), ...s[at].all.filter((x) => !got.includes(x.id))].slice(0, IDS_KEPT) } }));
    }
    setRefresh((n) => n + 1);
    return r;
  };
  const options = [
    { value: '$last', label: `the last ids I read${ids.last.length ? ` (${ids.last.join(', ')})` : ' (none yet)'}` },
    ...ids.all.map(({ id, by }) => ({ value: id, label: `${by} · ${id}` })),
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 @4xl:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><Waves className="size-4" /> Following {stream}</CardTitle>
            <CardDescription>A plain read loop from now on, one per stream on the backend, shared by every follower. Pending entries are amber.</CardDescription>
            <CardAction>
              <Badge variant="outline" className="font-mono">
                {follow.connection === 'lost' ? 'reconnecting…' : follow.loop === null ? 'joining…' : `loop #${follow.loop} · ${follow.listeners} following`}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {follow.error && <li className="text-destructive">read failed, retrying: {follow.error}</li>}
              {follow.entries.map((e) => <li key={e.id} className="break-all"><span className={cn('text-code-key', pendingIds.has(e.id) && 'text-warning')}>{e.id}</span> {JSON.stringify(e.fields)}</li>)}
              {!follow.entries.length && <li className="text-muted-foreground">no new entries yet: run add</li>}
            </ul>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Delivered, not acked</CardTitle>
            <CardDescription>Read with native XINFO + XPENDING: not part of the package.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending?.groups.map((g) => (
              <div key={g.name}>
                <div className="font-mono text-xs font-medium">{g.name}</div>
                <Table className="text-xs">
                  <TableBody>
                    {g.consumers.map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="w-20 font-mono">{c.name}</TableCell>
                        <TableCell className="whitespace-normal break-all font-mono text-warning">
                          {c.pending.map((p) => `${p.id}${p.deliveries > 1 ? ` ×${p.deliveries}` : ''}`).join(', ') || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!g.consumers.length && <TableRow><TableCell className="text-muted-foreground">no consumers yet</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            ))}
            {pending && !pending.groups.length && <p className="text-xs text-muted-foreground">No groups on {stream}. Run “Billing from now on” (createGroup) to see pending entries per consumer.</p>}
            {!pending && <p className="text-xs text-muted-foreground">reading…</p>}
          </CardContent>
        </Card>
      </div>
      <OpForm module="streams" ops={['createGroup', 'add', 'read', 'ack', 'delete', 'length']} mode={mode} tokens={options} onRun={run} onResult={onResult} />
    </div>
  );
}
