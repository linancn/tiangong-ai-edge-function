// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { runStructuredOpenAITask } from './openai_structured_task.ts';
import {
  buildMultilingualQuerySystemPrompt,
  MultilingualQueryProfile,
  multilingualQuerySchema,
  multilingualQueryWithAliasesSchema,
  QueryPack,
  sanitizeMultilingualQueryPack,
} from './search_query_utils.ts';

interface GenerateMultilingualQueryOptions {
  profile?: MultilingualQueryProfile;
}

async function generateQuery(query: string, options?: GenerateMultilingualQueryOptions) {
  const queryText = typeof query === 'string' ? query.trim() : String(query ?? '').trim();
  const profile = options?.profile ?? 'default';
  const useAliasSchema = profile !== 'default';
  const raw = await runStructuredOpenAITask<QueryPack>({
    schemaName: useAliasSchema
      ? `search_query_pack_generation_${profile}`
      : 'search_query_pack_generation',
    schema: useAliasSchema ? multilingualQueryWithAliasesSchema : multilingualQuerySchema,
    systemPrompt: buildMultilingualQuerySystemPrompt({ profile }),
    userPrompt: `Original query: ${queryText}`,
  });

  return sanitizeMultilingualQueryPack(raw, queryText);
}

export default generateQuery;
