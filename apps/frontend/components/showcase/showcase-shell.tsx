// The showcase shell: an icon-first sidebar (modes, feature modules, mode-specific modules), one mode at a time with an
// opt-in compare across modes, a right-hand Redis-state panel and one collapsible event log for all modes.
'use client';

import { ChevronsUpDown, Database, Play } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { spec, type Values } from '@/lib/showcase/examples';
import { MODES, MODE_ICON, MODULES, MODULE_ICON, healthDot, healthText, modeText, runOp, useStubLive, type Mode, type RunResult } from '@/lib/showcase/mock-backend';
import { useSessionLab } from '@/lib/showcase/mock-sessions';
import { RequestForm } from './request-form';
import { CliSnippet, Commands, HttpBadge, InsightLink, Json, KeysTable, ModeName } from './result-display';
import { FailoverSection } from './failover-section';
import { LockSection } from './lock-section';
import { PubSubSection } from './pubsub-section';
import { RateLimitSection } from './rate-limit-section';
import { SessionSection } from './session-section';
import { SlotsSection } from './slots-section';
import { StreamsSection } from './streams-section';

export function ShowcaseShell() {
  // ?module=<id> opens a section directly.
  const params = useSearchParams();
  const { status, events } = useStubLive();
  const [mode, setMode] = useState<Mode>('standalone');
  const [moduleId, setModuleId] = useState(MODULES.some((m) => m.id === params.get('module')) ? params.get('module')! : 'cache');
  const mod = MODULES.find((m) => m.id === moduleId)!;
  const [opId, setOpId] = useState(mod.ops[0].id);
  const op = mod.ops.find((o) => o.id === opId) ?? mod.ops[0];
  const opSpec = spec(moduleId, op.id);
  const [exampleId, setExampleId] = useState<string | null>(opSpec.examples[0].id);
  const [values, setValues] = useState<Values>(opSpec.examples[0].values);
  const example = opSpec.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const loadOp = (mId: string, oId: string) => {
    const first = spec(mId, oId).examples[0];
    setOpId(oId); setExampleId(first.id); setValues(first.values); setResults([]);
  };
  const [compare, setCompare] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const lab = useSessionLab(mode);

  const pickModule = (id: string) => {
    const m = MODULES.find((x) => x.id === id)!;
    setModuleId(id); loadOp(id, m.ops[0].id);
    if (m.onlyMode) { setMode(m.onlyMode); setCompare(false); }
  };
  const run = () => setResults((compare ? MODES : [mode]).map((md) => runOp(md, moduleId, op.id, values, status[md])));
  const focus = results.find((r) => r.mode === mode) ?? results[0];
  const s = status[focus?.mode ?? mode];

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="ioredis-toolkit showcase">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Database className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">ioredis-toolkit</span>
                  <span className="truncate text-xs text-muted-foreground">showcase</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Connection mode</SidebarGroupLabel>
            <SidebarMenu>
              {MODES.map((md) => {
                const Icon = MODE_ICON[md];
                return (
                  <SidebarMenuItem key={md}>
                    <SidebarMenuButton isActive={mode === md} disabled={!!mod.onlyMode && mod.onlyMode !== md}
                      tooltip={`${md} · ${status[md].health} · ${status[md].latencyMs}ms`}
                      onClick={() => { setMode(md); setResults([]); }}>
                      {/* icon in the mode's colour, health dot on its corner: still readable when collapsed */}
                      <span className={cn('relative flex size-4 shrink-0', modeText[md])}>
                        <Icon />
                        <span className={cn('absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-sidebar', healthDot[status[md].health])} />
                      </span>
                      <ModeName mode={md} />
                    </SidebarMenuButton>
                    <SidebarMenuBadge className="font-mono">{status[md].latencyMs}ms</SidebarMenuBadge>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarSeparator className="mx-0 hidden group-data-[collapsible=icon]:block" />
          <SidebarGroup>
            <SidebarGroupLabel>Feature modules</SidebarGroupLabel>
            <SidebarMenu>
              {MODULES.filter((m) => m.kind === 'feature').map((m) => {
                const Icon = MODULE_ICON[m.id];
                return (
                  <SidebarMenuItem key={m.id}>
                    <SidebarMenuButton isActive={moduleId === m.id} tooltip={m.label} onClick={() => pickModule(m.id)}>
                      <Icon /><span>{m.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarSeparator className="mx-0 hidden group-data-[collapsible=icon]:block" />
          <SidebarGroup>
            <SidebarGroupLabel>Mode-specific</SidebarGroupLabel>
            <SidebarMenu>
              {MODULES.filter((m) => m.kind === 'mode-specific').map((m) => {
                const Icon = MODULE_ICON[m.id];
                return (
                  <SidebarMenuItem key={m.id}>
                    <SidebarMenuButton isActive={moduleId === m.id} tooltip={`${m.label} · ${m.onlyMode} only`} onClick={() => pickModule(m.id)}>
                      <Icon className={modeText[m.onlyMode!]} /><span>{m.label}</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge><ModeName mode={m.onlyMode!} className="text-xs" /></SidebarMenuBadge>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="flex h-svh flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">{mod.label}</span>
          <span className="text-sm text-muted-foreground">on {compare ? 'all modes' : mode}</span>
          <div className="ml-auto"><ThemeToggle /></div>
        </header>

        <div className="flex min-h-0 flex-1">
          <ScrollArea className="min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
            <div className="@container space-y-5 p-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{mod.label}</h1>
                <p className="text-sm text-muted-foreground">{mod.blurb}</p>
              </div>
              {moduleId === 'session' ? (
                <SessionSection mode={mode} lab={lab} last={results[0] ?? null} onResult={(r) => setResults([r])} />
              ) : moduleId === 'failover' ? (
                <FailoverSection />
              ) : moduleId === 'slots' ? (
                <SlotsSection />
              ) : moduleId === 'lock' ? (
                <LockSection mode={mode} />
              ) : moduleId === 'rate-limit' ? (
                <RateLimitSection mode={mode} />
              ) : moduleId === 'pubsub' ? (
                <PubSubSection mode={mode} />
              ) : moduleId === 'streams' ? (
                <StreamsSection mode={mode} />
              ) : (<>
              <Tabs value={op.id} onValueChange={(v) => loadOp(moduleId, v)}>
                <TabsList variant="line">
                  {mod.ops.map((o) => <TabsTrigger key={o.id} value={o.id} className="font-mono">{o.label}</TabsTrigger>)}
                </TabsList>
              </Tabs>
              <RequestForm spec={opSpec} values={values} modified={modified} onChange={setValues}
                selected={modified ? null : exampleId} onPick={(ex) => { setExampleId(ex.id); setValues(ex.values); }}
                onReset={() => example && setValues(example.values)}
                footer={<>
                  <Button onClick={run}><Play /> Run{compare ? ' on all modes' : ` on ${mode}`}</Button>
                  {!mod.onlyMode && (
                    <div className="flex items-center gap-2">
                      <Checkbox id="compare" checked={compare} onCheckedChange={(v) => setCompare(v === true)} />
                      <Label htmlFor="compare" className="text-muted-foreground">Compare across all modes</Label>
                    </div>
                  )}
                  {modified && example && <span className="ml-auto text-xs text-muted-foreground">based on “{example.title}”</span>}
                </>} />
              <div className={cn('grid gap-4', results.length > 1 ? 'grid-cols-3' : 'grid-cols-1')}>
                {results.map((r) => (
                  <Card key={r.id} size="sm" onClick={() => setMode(r.mode)} className={cn('cursor-pointer', r.mode === focus?.mode && 'ring-2 ring-ring')}>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle><ModeName mode={r.mode} /></CardTitle>
                      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">{r.latencyMs}ms <HttpBadge code={r.httpStatus} /></div>
                    </CardHeader>
                    <CardContent><Json value={r.body} /></CardContent>
                  </Card>
                ))}
                {!results.length && <p className="text-sm text-muted-foreground">Run an operation to see its result here.</p>}
              </div>
              </>)}
            </div>
          </ScrollArea>

          {/* right rail: raw Redis state */}
          <aside className="w-96 shrink-0 border-l bg-muted/30">
            <ScrollArea className="h-full">
              <div className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase text-muted-foreground">Redis state</span>
                  <ModeName mode={focus?.mode ?? mode} className="text-sm" />
                </div>
                {focus ? (
                  <>
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Keys touched</Label><KeysTable keys={focus.keys} mode={focus.mode} /></div>
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Commands sent</Label><Commands r={focus} /></div>
                  </>
                ) : <p className="text-xs text-muted-foreground">Nothing yet.</p>}
                <Separator />
                <div className="space-y-2 text-xs">
                  <div className={cn('font-medium', healthText[s.health])}>{s.health} · {s.latencyMs}ms</div>
                  <div className="text-muted-foreground">{s.detail.join(' · ')}</div>
                  {s.failoverReady !== undefined && (
                    <Badge variant={s.failoverReady ? 'secondary' : 'destructive'}>{s.failoverReady ? 'failover ready' : 'not failover ready'}</Badge>
                  )}
                  <div><InsightLink mode={focus?.mode ?? mode} /></div>
                  <CliSnippet mode={focus?.mode ?? mode} />
                </div>
              </div>
            </ScrollArea>
          </aside>
        </div>

        {/* bottom: event log */}
        <Collapsible defaultOpen className="shrink-0 border-t">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between rounded-none text-muted-foreground">
              Event log · all modes <Badge variant="secondary">{events.length}</Badge><ChevronsUpDown className="ml-auto" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="h-32">
              <ul className="px-4 pb-14 font-mono text-xs">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3 py-0.5">
                    <span className="text-muted-foreground">{e.at}</span><ModeName mode={e.mode} className="w-20" />
                    <span className={e.kind === 'error' ? 'text-destructive' : 'text-warning'}>{e.text}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      </SidebarInset>
    </SidebarProvider>
  );
}
