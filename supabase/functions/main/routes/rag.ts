import { Hono } from '@hono/hono';
import ragProcess from '../controller/rag_graph.ts';

const ragRouter = new Hono();

ragRouter.post('/', async (c) => {
  const result = await ragProcess(c);
  return result;
});

export default ragRouter;

/*
curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/main/rag' \
    --header 'Content-Type: application/json' \
    --header 'email: YOUR_EMAIL' \
    --header 'password: YOUR_PASSWORD' \
    --data '{"query":"哪些公司使用了阿里云来帮助减排？"}'
*/
