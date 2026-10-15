// PROTOTYPE variant B: mode matrix. Modules as top tabs; three mode lanes (Cards) always on screen.
'use client';

import { Database, Play } from 'lucide-react';
import { useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { Commands, HealthDot, HttpBadge, InsightLink, Json, KeysTable, ModeName } from './bits';
import { MODES, MODULES, healthText, modeBorder, runOp, useStubLive, type Mode, type RunResult } from './stub';

export const name = 'Mode matrix, three lanes';

export function VariantB() {
  const { status, events, simulateFailover } = useStubLive();
  const [moduleId, setModuleId] = useState('cache');
  const mod = MODULES.find((m) => m.id === moduleId)!;
  const [opId, setOpId] = useState(mod.ops[0].id);
  const op = mod.ops.find((o) => o.id === opId) ?? mod.ops[0];
  const [input, setInput] = useState(op.input);
  const [targets, setTargets] = useState<string[]>([...MODES]);
  const [last, setLast] = useState<Partial<Record<Mode, RunResult>>>({});

  const applies = (md: Mode) => !mod.onlyMode || mod.onlyMode === md;
  const pick = (id: string) => {
    const m = MODULES.find((x) => x.id === id)!;
    setModuleId(id); setOpId(m.ops[0].id); setInput(m.ops[0].input); setLast({});
  };
  const run = (only?: Mode) => {
    const next = { ...last };
    for (const md of MODES) if (applies(md) && (only ? md === only : targets.includes(md))) next[md] = runOp(md, moduleId, op.id, input, status[md]);
    setLast(next);
  };

  return (
    <div className="flex h-svh flex-col bg-background">
      <header className="flex shrink-0 items-center gap-4 border-b px-4">
        <div className="flex items-center gap-2 py-3 text-sm font-semibold"><Database className="size-4" /> ioredis-toolkit</div>
        <Separator orientation="vertical" className="h-5" />
        <Tabs value={moduleId} onValueChange={pick} className="min-w-0 flex-1">
          <TabsList variant="line" className="h-12">
            {MODULES.map((m) => (
              <TabsTrigger key={m.id} value={m.id}>
                {m.label}{m.onlyMode && <Badge variant="outline" className="ml-1 px-1 text-[10px]"><ModeName mode={m.onlyMode} /></Badge>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ThemeToggle />
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-3">
        <span className="text-sm text-muted-foreground">{mod.blurb}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={op.id} onValueChange={(v) => { setOpId(v); setInput(mod.ops.find((o) => o.id === v)!.input); }}>
            <SelectTrigger className="w-44 font-mono"><SelectValue /></SelectTrigger>
            <SelectContent>{mod.ops.map((o) => <SelectItem key={o.id} value={o.id} className="font-mono">{o.label}</SelectItem>)}</SelectContent>
          </Select>
          {op.placeholder && <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={op.placeholder} className="w-56 font-mono" />}
          {!mod.onlyMode && (
            <ToggleGroup type="multiple" variant="outline" size="sm" value={targets} onValueChange={setTargets}>
              {MODES.map((md) => <ToggleGroupItem key={md} value={md}><ModeName mode={md} /></ToggleGroupItem>)}
            </ToggleGroup>
          )}
          <Button onClick={() => run()}><Play /> Run {mod.onlyMode ? `on ${mod.onlyMode}` : 'on selected'}</Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3 p-3">
        {MODES.map((md) => {
          const s = status[md];
          const r = last[md];
          const lane = events.filter((e) => e.mode === md);
          return (
            <Card key={md} className={cn('min-h-0 gap-0 border-t-4 py-0', modeBorder[md], !applies(md) && 'opacity-40')}>
              <CardHeader className="border-b py-4">
                <CardTitle className="flex items-center gap-2 text-lg"><HealthDot health={s.health} /><ModeName mode={md} /></CardTitle>
                <CardDescription>{s.detail.join(' · ')}</CardDescription>
                <CardAction className={cn('font-mono text-xs', healthText[s.health])}>{s.health} · {s.latencyMs}ms</CardAction>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {s.failoverReady !== undefined && <Badge variant={s.failoverReady ? 'secondary' : 'destructive'}>{s.failoverReady ? 'failover ready' : 'not failover ready'}</Badge>}
                  <InsightLink mode={md} />
                  {applies(md) && <Button variant="link" size="xs" className="h-auto px-0" onClick={() => run(md)}>run here only</Button>}
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 p-0">
                <ScrollArea className="h-full">
                  <div className="space-y-4 p-4">
                    {!applies(md) && <p className="text-sm text-muted-foreground">{mod.label} only exists on {mod.onlyMode}.</p>}
                    {applies(md) && md === 'sentinel' && mod.id === 'failover' && <Button variant="outline" onClick={simulateFailover}>Simulate failover in status</Button>}
                    {r ? (
                      <>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-mono">{r.at} · {r.op}({r.input})</span>
                          <span className="flex items-center gap-2 font-mono">{r.latencyMs}ms <HttpBadge code={r.httpStatus} /></span>
                        </div>
                        <Json value={r.body} />
                        <div className="space-y-1"><div className="text-xs font-medium uppercase text-muted-foreground">Keys</div><KeysTable keys={r.keys} mode={md} /></div>
                        <div className="space-y-1"><div className="text-xs font-medium uppercase text-muted-foreground">Commands</div><Commands r={r} /></div>
                      </>
                    ) : applies(md) && <p className="text-sm text-muted-foreground">No run yet.</p>}
                  </div>
                </ScrollArea>
              </CardContent>
              <CardFooter className="block h-28 border-t bg-muted/30 p-0">
                <ScrollArea className="h-full">
                  <ul className="px-4 py-2 font-mono text-[11px]">
                    {lane.map((e) => <li key={e.id} className={e.kind === 'error' ? 'text-destructive' : 'text-warning'}><span className="text-muted-foreground">{e.at}</span> {e.text}</li>)}
                    {!lane.length && <li className="text-muted-foreground">event log: quiet</li>}
                  </ul>
                </ScrollArea>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
