// The streams section: a follow pane of entries as they're added and a per-group table of delivered-but-unacked
// entries (native XPENDING) on top; the operation form below.
'use client';

import { Waves } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { Values } from '@/lib/showcase/examples';
import type { Mode } from '@showcase/contracts';
import { useStreamSim, simulated } from '@/lib/showcase/mock-live';
import { OpForm } from './op-form';

const parse = (s: unknown) => { try { return JSON.parse(String(s)); } catch { return {}; } };

export function StreamsSection({ mode }: { mode: Mode }) {
  const st = useStreamSim();
  const { entries, groups } = st;
  const pendingIds = new Set(Object.values(groups).flatMap((g) => Object.values(g.pending).flat()));
  const consumers = [...new Set(['worker-1', 'worker-2', ...Object.values(groups).flatMap((g) => Object.keys(g.pending))])];
  const runSim = (op: string, v: Values): unknown => {
    if (op === 'createGroup') return st.createGroup(String(v.group), v.start as '$' | '0');
    if (op === 'add') return st.add(parse(v.fields));
    if (op === 'read') return st.readGroup(String(v.group), String(v.consumer), Number(v.count), v.pending === true);
    const ids = String(v.ids) === '$last' ? Object.values(st.read).flat().slice(-2) : String(v.ids).split(',').map((x) => x.trim());
    return st.ack(String(v.group), ids);
  };
  const run = (op: string, v: Values) => simulated(mode, 'streams', op, runSim(op, v));
  const tokens = [
    { value: '$last', label: 'the last ids I read' },
    ...Object.entries(st.read).flatMap(([c, ids]) => ids.map((id) => ({ value: id, label: `${c} · ${id}` }))),
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 @4xl:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><Waves className="size-4" /> Following orders</CardTitle>
            <CardDescription>A plain read from $: every entry as it is added. Pending entries are amber.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {entries.slice(-10).map((e) => <li key={e.id}><span className={cn('text-code-key', pendingIds.has(e.id) && 'text-warning')}>{e.id}</span> {JSON.stringify(e.fields)}</li>)}
              {!entries.length && <li className="text-muted-foreground">empty stream</li>}
            </ul>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Delivered, not acked</CardTitle>
            <CardDescription>Read with native XPENDING: not part of the package.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.values(groups).map((g) => (
              <div key={g.name}>
                <div className="font-mono text-xs font-medium">{g.name}</div>
                <Table className="text-xs">
                  <TableBody>
                    {consumers.map((c) => (
                      <TableRow key={c}>
                        <TableCell className="w-20 font-mono">{c}</TableCell>
                        <TableCell className="font-mono text-warning">{(g.pending[c] ?? []).join(', ') || <span className="text-muted-foreground">—</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
            {!Object.keys(groups).length && <p className="text-xs text-muted-foreground">No groups yet. Run “Billing from now on” to see pending entries per consumer.</p>}
          </CardContent>
        </Card>
      </div>
      <OpForm module="streams" ops={['createGroup', 'add', 'read', 'ack']} mode={mode} tokens={tokens} onRun={run} />
    </div>
  );
}
