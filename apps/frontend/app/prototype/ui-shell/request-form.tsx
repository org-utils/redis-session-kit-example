// PROTOTYPE: built-in example picker and the editable request form, composed from shadcn primitives.
'use client';

import { Code2, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Example, Field, OpSpec, Value, Values } from './examples';

export function ExamplePicker({ examples, selected, onPick }: { examples: Example[]; selected: string | null; onPick: (e: Example) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">Examples</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
        {examples.map((e) => (
          <Card key={e.id} size="sm" role="button" tabIndex={0} onClick={() => onPick(e)} onKeyDown={(k) => k.key === 'Enter' && onPick(e)}
            className={cn('cursor-pointer gap-1 transition-colors hover:bg-accent', selected === e.id && 'ring-2 ring-primary')}>
            <CardHeader>
              <CardTitle className="text-sm">{e.title}</CardTitle>
              <CardDescription className="text-xs">{e.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: Value; onChange: (v: Value) => void }) {
  const id = `f-${field.name}`;
  switch (field.kind) {
    case 'json':
      return <Textarea id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} rows={3} className="font-mono text-xs" />;
    case 'number':
      return <Input id={id} type="number" step="any" value={String(value)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className="font-mono" />;
    case 'boolean':
      return <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
    case 'select':
      return (
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full font-mono"><SelectValue /></SelectTrigger>
          <SelectContent>{field.options!.map((o) => <SelectItem key={o} value={o} className="font-mono">{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    default:
      return <Input id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} className="font-mono" />;
  }
}

export function RequestForm({ spec, values, modified, onChange, onReset, footer }: {
  spec: OpSpec; values: Values; modified: boolean; onChange: (v: Values) => void; onReset: () => void; footer: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request</CardTitle>
        <CardDescription>Start from an example, then change anything.</CardDescription>
        <CardAction className="flex items-center gap-2">
          {modified && <Badge variant="secondary">Modified</Badge>}
          <Button variant="ghost" size="sm" onClick={onReset} disabled={!modified}><RotateCcw /> Reset</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {spec.fields.map((f) => (
            <div key={f.name} className={cn('space-y-1.5', f.kind === 'json' && 'col-span-2', f.kind === 'boolean' && 'col-span-2 flex items-center gap-3 space-y-0')}>
              <Label htmlFor={`f-${f.name}`} className={cn('font-mono text-xs', f.kind === 'boolean' && 'order-last')}>{f.label}</Label>
              <FieldInput field={f} value={values[f.name] ?? ''} onChange={(v) => onChange({ ...values, [f.name]: v })} />
              {f.help && f.kind !== 'boolean' && <p className="text-xs text-muted-foreground">{f.help}</p>}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground"><Code2 className="size-3.5" /> Equivalent call</Label>
          <pre className="overflow-x-auto rounded-md bg-code p-3 font-mono text-xs text-code-foreground">{spec.call(values)}</pre>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 border-t">{footer}</CardFooter>
    </Card>
  );
}
