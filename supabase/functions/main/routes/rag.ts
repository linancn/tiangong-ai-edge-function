import { Hono } from "jsr:@hono/hono";
import { bearerAuth } from "jsr:@hono/hono/bearer-auth";
import ragProcess from "../controller/rag_graph.ts";

const token = Deno.env.get("TOKEN") ?? "";

const ragRouter = new Hono();

ragRouter.post("/", bearerAuth({ token }), async (c) => {
  const result = await ragProcess(c);
  return result;
});

export default ragRouter;

/*
curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/main/rag' \
    --header 'Authorization: Bearer YourKey' \
    --header 'Content-Type: application/json' \
    --data '{"query":"哪些公司使用了阿里云来帮助减排？"}'
*/
