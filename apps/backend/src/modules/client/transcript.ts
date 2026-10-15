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
