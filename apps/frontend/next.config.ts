import type { NextConfig } from 'next';
import { env } from './lib/env';

const config: NextConfig = {
  // The browser calls /api/* on this origin; Next.js forwards it to Fastify, so cookies land here and no CORS is needed.
  rewrites: async () => [{ source: '/api/:path*', destination: `${env.BACKEND_URL}/api/:path*` }],
};

export default config;
