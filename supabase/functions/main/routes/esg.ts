import { Hono } from '@hono/hono';
import esgProcess from '../controller/esg_graph.ts';

const esgRouter = new Hono();

esgRouter.post('/', async (c) => {
  const result = await esgProcess(c);
  return result;
});

export default esgRouter;
