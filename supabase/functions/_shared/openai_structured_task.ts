import { openaiStructuredOutput } from './openai_structured.ts';

export interface OpenAIStructuredTaskRequest {
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  modelEnvName?: string;
  fallbackModel?: string;
  temperature?: number;
  baseUrl?: string;
  reasoningEffort?: string;
}

export function resolveOpenAIChatModel(
  modelEnvName = 'OPENAI_CHAT_MODEL',
  fallbackModel = 'gpt-4o-mini',
): string {
  const model = Deno.env.get(modelEnvName)?.trim();
  return model || fallbackModel;
}

export async function runStructuredOpenAITask<T>(request: OpenAIStructuredTaskRequest): Promise<T> {
  const model =
    request.model ?? resolveOpenAIChatModel(request.modelEnvName, request.fallbackModel);

  return await openaiStructuredOutput<T>({
    schemaName: request.schemaName,
    schema: request.schema,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    options: {
      model,
      temperature: request.temperature ?? 0,
      baseUrl: request.baseUrl,
      reasoningEffort: request.reasoningEffort,
    },
  });
}
