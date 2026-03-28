// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { runStructuredOpenAITask } from './openai_structured_task.ts';
import {
  CONTROLLED_SYNONYM_RULES,
  multilingualQuerySchema,
  MultilingualSearchQuery,
  sanitizeMultilingualSearchQueryOutput,
} from './search_query_utils.ts';

async function generateQuery(query: string) {
  const queryText = typeof query === 'string' ? query.trim() : String(query ?? '').trim();
  const raw = await runStructuredOpenAITask<MultilingualSearchQuery>({
    schemaName: 'search_query_generation',
    schema: multilingualQuerySchema,
    systemPrompt: `Task: Transform the original query into four specific fields for retrieval.
- SemanticQuery should be a concise canonical query for semantic retrieval in the user's original language when possible.
- FulltextQueryENG should contain English aliases only.
- FulltextQueryChiSim should contain Simplified Chinese aliases only.
- FulltextQueryChiTra should contain Traditional Chinese aliases only.
${CONTROLLED_SYNONYM_RULES}`,
    userPrompt: `Original query: ${queryText}`,
  });

  return sanitizeMultilingualSearchQueryOutput(raw, queryText);
}

export default generateQuery;
