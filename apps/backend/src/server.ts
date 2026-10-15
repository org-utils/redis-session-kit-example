// Starts the backend. `pnpm dev` runs it under `node --watch --env-file-if-exists=.env`.
import { buildApp } from './app.ts';
import { type Config, loadConfig } from './config/index.ts';

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const app = await buildApp({ config, logger: { level: 'info' } });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

// `localhost` listens on both 127.0.0.1 and ::1, whichever BACKEND_URL's `localhost` resolves to.
await app.listen({ port: config.PORT, host: 'localhost' });
