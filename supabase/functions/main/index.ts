import { Hono } from "jsr:@hono/hono";
import esgRouter from "./routes/esg.ts";
import healthRouter from "./routes/health.ts";

// const app = new Hono();
const app = new Hono().basePath(`/main`);

app.route("/health", healthRouter);
app.route("/esg", esgRouter);

Deno.serve(app.fetch);
