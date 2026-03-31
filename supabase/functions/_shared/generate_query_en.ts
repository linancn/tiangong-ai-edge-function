// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";

import { runStructuredOpenAITask } from "./openai_structured_task.ts";
import {
  buildEnglishQuerySystemPrompt,
  EnglishQueryPack,
  EnglishQueryProfile,
  englishQuerySchema,
  englishQueryWithAliasesSchema,
  sanitizeEnglishQueryPack,
} from "./search_query_utils.ts";

interface GenerateEnglishQueryOptions {
  profile?: EnglishQueryProfile;
}

async function generateQuery(
  query: string,
  options?: GenerateEnglishQueryOptions,
) {
  const queryText = typeof query === "string"
    ? query.trim()
    : String(query ?? "").trim();
  const profile = options?.profile ?? "default";
  const useAliasSchema = profile !== "default";
  const raw = await runStructuredOpenAITask<EnglishQueryPack>({
    schemaName: useAliasSchema
      ? `english_query_pack_generation_${profile}`
      : "english_query_pack_generation",
    schema: useAliasSchema ? englishQueryWithAliasesSchema : englishQuerySchema,
    systemPrompt: buildEnglishQuerySystemPrompt({ profile }),
    userPrompt: `Original query: ${queryText}`,
  });

  return sanitizeEnglishQueryPack(raw, queryText);
}

export default generateQuery;
