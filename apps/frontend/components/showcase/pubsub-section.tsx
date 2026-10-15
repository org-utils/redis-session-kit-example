// The pub/sub section: one card per subscription with its messages, and the count publish returned next to how many
// cards received it, on top; the operation form below. Each card is a live SSE stream to the backend.
'use client';

import { Loader2, Radio, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { runOperation, type RunResult } from '@/lib/showcase/api';
import { spec, type Values } from '@/lib/showcase/examples';
import { usePubSubCards } from '@/lib/showcase/use-pubsub-cards';
import type { Mode } from '@showcase/contracts';
import { OpForm } from './op-form';

export function PubSubSection({ mode, onResult }: { mode: Mode; onResult: (r: RunResult) => void }) {
  const ps = usePubSubCards();
  const cards = ps.cards.filter((c) => c.mode === mode);
  const publishes = ps.publishes.filter((p) => p.mode === mode);
  const run = (op: string, v: Values): Promise<RunResult> => {
    const channel = String(v.channel);
    if (op === 'subscribe') return ps.subscribe(mode, channel);
    const raw = v.raw === true;
    // What a card would receive: the JSON value, re-serialized; a raw message never reaches one.
    let text = String(v.message);
    try { text = JSON.stringify(JSON.parse(text)); } catch { /* raw text, sent as is */ }
    return ps.publish(mode, channel, raw, text, () => runOperation(mode, 'pubsub', raw ? 'publish-raw' : 'publish', () => spec('pubsub', 'publish').body!(v)));
  };
  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Radio className="size-4" /> Subscriptions</CardTitle>
          <CardDescription>One card per subscribe, each a live stream. Cards on the same channel share one Redis SUBSCRIBE; closing the last one sends the UNSUBSCRIBE.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 @3xl:grid-cols-2">
            {cards.map((c) => (
              <div key={c.id} className={cn('rounded-lg border p-2', c.state === 'failed' && 'border-destructive')}>
                <div className="flex items-center justify-between gap-2 font-mono text-xs">
                  <span className="text-code-key">{c.channel}</span>
                  <span className="ml-auto">
                    {c.state === 'subscribing' && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                    {c.state === 'subscribed' && <Badge variant="outline" className="font-mono text-[10px]">live</Badge>}
                  </span>
                  <Button size="icon-xs" variant="ghost" onClick={() => ps.unsubscribe(c.id)} aria-label="Unsubscribe"><X /></Button>
                </div>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                  {c.error && <li className="text-destructive">{c.error}</li>}
                  {c.messages.map((m) => <li key={m.seq} className="break-all"><span className="text-muted-foreground">#{m.seq}</span> {JSON.stringify(m.value)}</li>)}
                  {!c.messages.length && !c.error && <li className="text-muted-foreground">waiting…</li>}
                </ul>
              </div>
            ))}
            {!cards.length && <p className="text-xs text-muted-foreground">No subscriptions on {mode}. Run “Listen to orders” to open a card.</p>}
          </div>
          {publishes.length > 0 && (
            <Table className="text-xs">
              <TableHeader><TableRow><TableHead>publish</TableHead><TableHead>returned</TableHead><TableHead>cards received</TableHead></TableRow></TableHeader>
              <TableBody>
                {publishes.slice(0, 5).map((p) => {
                  const received = p.receivedBy.length;
                  const differs = p.returned !== null && p.returned !== received;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono">{p.channel}{p.raw && <span className="text-muted-foreground"> · raw</span>}</TableCell>
                      <TableCell className="font-mono">{p.returned ?? '…'}</TableCell>
                      <TableCell className={cn('font-mono', differs && 'text-warning')}>{received}{differs && ' ≠ returned'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <OpForm module="pubsub" ops={['subscribe', 'publish']} mode={mode} onRun={run} onResult={onResult} />
    </div>
  );
}
