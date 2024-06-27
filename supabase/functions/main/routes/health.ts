import { Hono } from "jsr:@hono/hono";

const healthRouter = new Hono();

healthRouter.get('/', (c) => c.json({ status: "healthy" }));

export default healthRouter;
