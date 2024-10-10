import { Hono } from '@hono/hono';
import healthRouter from './routes/health.ts';
import ragRouter from './routes/rag.ts';

// const app = new Hono();
const app = new Hono().basePath(`/main`);

app.route('/health', healthRouter);
app.route('/rag', ragRouter);

Deno.serve(app.fetch);
