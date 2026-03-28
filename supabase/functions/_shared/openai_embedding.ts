import { getOpenAIClient } from './openai_client.ts';

export interface OpenAIEmbeddingOptions {
  model?: string;
  baseUrl?: string;
}

export async function generateEmbedding(
  input: string,
  options: OpenAIEmbeddingOptions = {},
): Promise<number[]> {
  const normalizedInput = typeof input === 'string' ? input.trim() : String(input ?? '').trim();
  if (!normalizedInput) {
    throw new Error('OpenAI embedding input must not be empty');
  }

  const baseUrl = options.baseUrl || Deno.env.get('OPENAI_BASE_URL') || undefined;
  const model = options.model?.trim() || Deno.env.get('OPENAI_EMBEDDING_MODEL') || undefined;

  if (!model) {
    throw new Error('Missing OPENAI_EMBEDDING_MODEL environment variable');
  }

  const client = getOpenAIClient(baseUrl);
  const response = await client.embeddings.create({
    model,
    input: normalizedInput,
  });

  const embedding = response.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('OpenAI response did not contain an embedding');
  }

  return embedding;
}
