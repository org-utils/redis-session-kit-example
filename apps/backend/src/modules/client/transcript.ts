// A temporary-client demo's result: each call it made, in order, with what it returned or threw. A demo is a sequence
// (an override throws, then the config shows it was kept), so a call that throws is recorded rather than answered as
// an error response, and the steps after it still run.
import type { ClientStep } from '@showcase/contracts';

/** The steps of one demo, and the way to add one. */
export interface Transcript {
  /** In the order they ran. */
  readonly steps: ClientStep[];
  /** Runs `run` and records what it returned (left out when undefined) or threw. Resolves to whether it returned. */
  step(call: string, run: () => unknown): Promise<boolean>;
}

/** An empty transcript, for one request. */
/** A JSON value as it would be written in code, for a step's call: `{ defaultTtl: 5 }`, `'replace'`. */
export function literal(value: unknown): string {
  if (typeof value === 'string') return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, v]) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : literal(key)}: ${literal(v)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

export function createTranscript(): Transcript {
  const steps: ClientStep[] = [];
  return {
    steps,
    async step(call, run) {
      try {
        const value = await run();
        steps.push({ call, ok: true, ...(value !== undefined && { value }) });
        return true;
      } catch (error) {
        const { name, message, code }: Error & { code?: unknown } = error instanceof Error ? error : new Error(String(error));
        steps.push({ call, ok: false, error: { ...(typeof code === 'string' && { code }), name, message } });
        return false;
      }
    },
  };
}
