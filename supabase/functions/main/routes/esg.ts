import { Hono } from "jsr:@hono/hono";
import esgComplianceProcess from "../controllers/esg_compliance.ts";

const esgRouter = new Hono();

esgRouter.post('/', async (c) => {
    const result = await esgComplianceProcess(c);
    return result;
  });

export default esgRouter;

/*
curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/main/esg' \
    --header 'Content-Type: application/json' \
    --data '{"query":"哪些公司使用了阿里云来帮助减排？"}'

*/