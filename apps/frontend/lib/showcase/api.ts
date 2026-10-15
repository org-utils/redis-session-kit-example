// Running one feature module operation against the backend (POST /api/:mode/:module/:op through the Next.js rewrite),
// and the RunResult every section's result cards and the Redis-state panel show.
import { ErrorBodySchema, TracedResultSchema, type Mode, type RedisTrace, type TracedCommand, type TracedKey } from '@showcase/contracts';

export type KeyTouched = TracedKey;

export interface RunResult {
  id: number; at: string; mode: Mode; module: string; op: string; input: string;
  /** 0 when the request was never sent (the form's values couldn't be turned into one). */
  httpStatus: number; latencyMs: number;
  /** The package's result, or the `{ error }` body. */
  body: unknown;
  keys: KeyTouched[]; commands: string[];
  omitted?: RedisTrace['omitted'];
}

let runId = 0;

/** `SET showcase:cache:user:42 {"id":"42"} EX 300`, as redis-cli would show it; on cluster with the node it went to. */
export function formatCommand({ name, args, node }: TracedCommand, mode: Mode): string {
  const quoted = args.map((a) => (a === '' || /\s/.test(a) ? JSON.stringify(a) : a));
  const line = [name.toUpperCase(), ...quoted].join(' ');
  return mode === 'cluster' && node ? `${line}  → ${node.split(':').pop()}` : line;
}

/**
 * Sends one operation and turns the reply into a RunResult. `request` builds the body from the form; if it throws
 * (say, a value that isn't JSON), nothing is sent and its message shows as the result.
 */
export async function runOperation(mode: Mode, module: string, op: string, request: () => unknown): Promise<RunResult> {
  const base = { id: ++runId, at: new Date().toLocaleTimeString(), mode, module, op, keys: [], commands: [] };
  let body: unknown;
  try {
    body = request();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, input: '', httpStatus: 0, latencyMs: 0, body: { error: { code: 'NOT_SENT', message } } };
  }
  const started = performance.now();
  try {
    const res = await fetch(`/api/${mode}/${module}/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const latencyMs = +(performance.now() - started).toFixed(1);
    const json = await res.json();
    const parsed = res.ok ? TracedResultSchema.parse(json) : ErrorBodySchema.parse(json);
    const redis = parsed.redis;
    return {
      ...base,
      input: JSON.stringify(body),
      httpStatus: res.status,
      latencyMs,
      body: 'result' in parsed ? parsed.result : { error: parsed.error },
      keys: redis?.keys ?? [],
      commands: redis?.commands.map((c) => formatCommand(c, mode)) ?? [],
      ...(redis?.omitted && { omitted: redis.omitted }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base, input: JSON.stringify(body), httpStatus: 0, latencyMs: +(performance.now() - started).toFixed(1),
      body: { error: { code: 'BACKEND_UNREACHABLE', message } },
    };
  }
}
