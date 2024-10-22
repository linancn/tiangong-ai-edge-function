import { Hono } from '@hono/hono';
import esgRouter from './routes/esg.ts';
import healthRouter from './routes/health.ts';
import ragRouter from './routes/rag.ts';

// const app = new Hono();
const app = new Hono().basePath(`/main`);

app.route('/health', healthRouter);
app.route('/rag', ragRouter);
app.route('/esg', esgRouter);

Deno.serve(app.fetch);
