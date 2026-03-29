// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { runStructuredOpenAITask } from './openai_structured_task.ts';
import {
  buildEnglishQuerySystemPrompt,
  englishQuerySchema,
  EnglishQueryPack,
  sanitizeEnglishQueryPack,
} from './search_query_utils.ts';

async function generateQuery(query: string) {
  const queryText = typeof query === 'string' ? query.trim() : String(query ?? '').trim();
  const raw = await runStructuredOpenAITask<EnglishQueryPack>({
    schemaName: 'english_query_pack_generation',
    schema: englishQuerySchema,
    systemPrompt: buildEnglishQuerySystemPrompt(),
    userPrompt: `Original query: ${queryText}`,
  });

  return sanitizeEnglishQueryPack(raw, queryText);
}

export default generateQuery;
