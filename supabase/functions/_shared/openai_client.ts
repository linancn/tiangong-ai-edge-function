import OpenAI from '@openai/openai';

const clients = new Map<string, OpenAI>();

export function getOpenAIClient(baseUrl?: string): OpenAI {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }

  const cacheKey = `${apiKey}@@${baseUrl || ''}`;
  const existing = clients.get(cacheKey);
  if (existing) {
    return existing;
  }

  const config: { apiKey: string; baseURL?: string } = { apiKey };
  if (baseUrl) {
    config.baseURL = baseUrl;
  }

  const client = new OpenAI(config);
  clients.set(cacheKey, client);
  return client;
}
