// The pub/sub section: one card per subscription with its messages, and the count publish returned next to how many
// cards received it, on top; the operation form below.
'use client';

import { Radio, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { Values } from '@/lib/showcase/examples';
import type { Mode } from '@/lib/showcase/mock-backend';
import { usePubSubSim } from '@/lib/showcase/mock-live';
import { OpForm } from './op-form';

export function PubSubSection({ mode }: { mode: Mode }) {
  const ps = usePubSubSim(mode);
  const run = (op: string, v: Values) => {
    if (op === 'subscribe') { ps.subscribe(String(v.channel)); return { subscribed: v.channel }; }
    return ps.publish(String(v.channel), String(v.message)).returned;
  };
  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Radio className="size-4" /> Subscriptions</CardTitle>
          <CardDescription>One card per subscribe. Cards on the same channel share one Redis SUBSCRIBE.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 @3xl:grid-cols-2">
            {ps.cards.map((c) => (
              <div key={c.id} className="rounded-lg border p-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-code-key">{c.channel}</span>
                  <Button size="icon-xs" variant="ghost" onClick={() => ps.unsubscribe(c.id)} aria-label="Unsubscribe"><X /></Button>
                </div>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                  {c.messages.map((m) => <li key={m.seq}><span className="text-muted-foreground">#{m.seq}</span> {m.value}</li>)}
                  {!c.messages.length && <li className="text-muted-foreground">waiting…</li>}
                </ul>
              </div>
            ))}
            {!ps.cards.length && <p className="text-xs text-muted-foreground">No subscriptions. Run “Listen to orders” to open a card.</p>}
          </div>
          {ps.pubs.length > 0 && (
            <Table className="text-xs">
              <TableHeader><TableRow><TableHead>publish</TableHead><TableHead>returned</TableHead><TableHead>cards received</TableHead></TableRow></TableHeader>
              <TableBody>
                {ps.pubs.slice(0, 5).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.channel}</TableCell>
                    <TableCell className="font-mono">{p.returned}</TableCell>
                    <TableCell className={cn('font-mono', p.returned !== p.delivered && 'text-warning')}>{p.delivered}{p.returned !== p.delivered && ' ≠ returned'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <OpForm module="pubsub" ops={['subscribe', 'publish']} mode={mode} onRun={run} />
    </div>
  );
}
