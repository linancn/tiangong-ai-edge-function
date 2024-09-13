import { Hono } from "jsr:@hono/hono";

const healthRouter = new Hono();

healthRouter.get('/', (c) => c.json({ status: "healthy" }));

export default healthRouter;

/*
curl -i --location --request GET 'http://127.0.0.1:64321/functions/v1/main/health'
*/