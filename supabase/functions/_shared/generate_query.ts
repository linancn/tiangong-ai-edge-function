// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { runStructuredOpenAITask } from './openai_structured_task.ts';
import {
  buildMultilingualQuerySystemPrompt,
  multilingualQuerySchema,
  QueryPack,
  sanitizeMultilingualQueryPack,
} from './search_query_utils.ts';

async function generateQuery(query: string) {
  const queryText = typeof query === 'string' ? query.trim() : String(query ?? '').trim();
  const raw = await runStructuredOpenAITask<QueryPack>({
    schemaName: 'search_query_pack_generation',
    schema: multilingualQuerySchema,
    systemPrompt: buildMultilingualQuerySystemPrompt(),
    userPrompt: `Original query: ${queryText}`,
  });

  return sanitizeMultilingualQueryPack(raw, queryText);
}

export default generateQuery;
