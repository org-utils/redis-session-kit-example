// First-render status, fetched by the page on the server straight from the backend (not through the rewrite).
import 'server-only';
import { StatusResponseSchema, type StatusResponse } from '@showcase/contracts';
import { env } from '../env';

/** The backend's status, or null if it isn't reachable; the event stream fills it in once it is. */
export async function fetchStatus(): Promise<StatusResponse | null> {
  try {
    const res = await fetch(`${env.BACKEND_URL}/api/status`, { cache: 'no-store', signal: AbortSignal.timeout(1000) });
    return res.ok ? StatusResponseSchema.parse(await res.json()) : null;
  } catch {
    return null;
  }
}
