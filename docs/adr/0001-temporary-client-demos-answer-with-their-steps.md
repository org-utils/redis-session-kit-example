# Multi-step temporary-client demos answer 200 with their steps

The backend layout decision (#5, item 7) sends every error through one error handler with a fixed status map, so a `*_CONFIGURATION` error is a 500. The client section's `with*()` overrides and shutdown operations are sequences whose point is what happens *after* a call throws: a colliding `withLock()` throws `REDIS_CONFIGURATION` and the config in effect is then shown to be unchanged; a subscribe after `close()` rejects while the blocked read beside it shows how it ended. An error response would stop at the throw. So these two operations answer 200 with their steps in order, each with what it returned or threw (`{ call, ok: true, value? }` or `{ call, ok: false, error: { code?, name, message } }`), and the steps after a throw still run. Single-call operations, config validation and namespace collision included, keep going through the error handler.

## Consequences

- A 200 from `client/with` or `client/shutdown` does not mean every call succeeded: read each step's `ok`.
- A step's `error` carries no `mode` and no status code; the mode is the request's, and the status map does not apply inside a transcript.
