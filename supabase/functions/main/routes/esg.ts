import { Hono } from "jsr:@hono/hono";
import { bearerAuth } from "jsr:@hono/hono/bearer-auth";
import esgComplianceProcess from "../controller/esg_compliance_graph.ts";

const token = Deno.env.get("TOKEN") ?? "";

const esgRouter = new Hono();

esgRouter.post("/", bearerAuth({ token }), async (c) => {
  const result = await esgComplianceProcess(c);
  return result;
});

export default esgRouter;

/*
curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/main/esg' \
    --header 'Authorization: Bearer YourKey' \
    --header 'Content-Type: application/json' \
    --data '{"query":"哪些公司使用了阿里云来帮助减排？"}'
*/
