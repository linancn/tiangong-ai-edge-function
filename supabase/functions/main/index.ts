import { Hono } from "jsr:@hono/hono";
import esgRouter from "./routes/esg.ts";
import healthRouter from "./routes/health.ts";
import ragRouter from "./routes/rag.ts";

// const app = new Hono();
const app = new Hono().basePath(`/main`);

app.route("/health", healthRouter);
app.route("/esg", esgRouter);
app.route("/rag", ragRouter);

Deno.serve(app.fetch);
