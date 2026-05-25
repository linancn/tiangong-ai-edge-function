import { getOpenAIClient } from '../supabase/functions/_shared/openai_client.ts';
import { runStructuredOpenAITask } from '../supabase/functions/_shared/openai_structured_task.ts';
import {
  buildEnglishQuerySystemPrompt,
  buildMultilingualQuerySystemPrompt,
  EnglishQueryPack,
  EnglishQueryProfile,
  englishQuerySchema,
  englishQueryWithAliasesSchema,
  MultilingualQueryProfile,
  multilingualQuerySchema,
  multilingualQueryWithAliasesSchema,
  QueryPack,
  sanitizeEnglishQueryPack,
  sanitizeMultilingualQueryPack,
} from '../supabase/functions/_shared/search_query_utils.ts';
import { FUNCTION_SPECS, FunctionSpec } from './eval_search_quality.ts';

type RewriteMode = 'multilingual' | 'english';
type CandidateStatus = 'ok' | 'rejected' | 'incompatible';

interface Candidate {
  id: string;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  reasoningEffort?: 'none';
  optional?: boolean;
}

interface RewriteSpec {
  name: string;
  mode: RewriteMode;
  multilingualProfile?: MultilingualQueryProfile;
  englishProfile?: EnglishQueryProfile;
  queries: string[];
}

interface RewriteRun {
  query: string;
  ok: boolean;
  sanitized?: QueryPack | EnglishQueryPack;
  normalized?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
}

interface ModelEvaluation {
  candidate: Candidate;
  runs: RewriteRun[];
  compatibilityError?: string;
}

interface ModelJudgment {
  query: string;
  candidate_score: number;
  baseline_score: number;
  winner: 'candidate' | 'baseline' | 'tie' | 'both_bad';
  reason: string;
}

interface CandidateSummary {
  id: string;
  model: string;
  status: CandidateStatus;
  queries: number;
  ok: number;
  json_validity_rate: number;
  schema_validity_rate: number;
  avg_quality: number;
  baseline_avg_quality: number;
  p50_latency_ms: number;
  p90_latency_ms: number;
  p95_latency_ms: number;
  total_cost_usd: number;
  combined_score: number;
  rejection_reasons: string[];
}

interface CliOptions {
  dryRun: boolean;
  limit: number | null;
  repeats: number;
  includeOptional: boolean;
  judgeModel: string;
  outputPrefix: string;
  models: Set<string> | null;
}

const BASELINE_ID = 'gpt-4.1-mini';
const DEFAULT_OUTPUT_PREFIX = `/tmp/tiangong-eval/query-rewrite-model-eval-${Date.now()}`;

const CANDIDATES: Candidate[] = [
  {
    id: 'gpt-4.1-mini',
    model: 'gpt-4.1-mini',
    inputPricePerMillion: 0.4,
    outputPricePerMillion: 1.6,
  },
  {
    id: 'gpt-4.1-nano',
    model: 'gpt-4.1-nano',
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
  },
  {
    id: 'gpt-4o-mini',
    model: 'gpt-4o-mini',
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
  {
    id: 'gpt-5-nano-none',
    model: 'gpt-5-nano',
    reasoningEffort: 'none',
    inputPricePerMillion: 0.05,
    outputPricePerMillion: 0.4,
  },
  {
    id: 'gpt-5.4-nano-none',
    model: 'gpt-5.4-nano',
    reasoningEffort: 'none',
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 1.25,
    optional: true,
  },
];

const COURSE_SPEC: RewriteSpec = {
  name: 'course_search',
  mode: 'multilingual',
  queries: [
    '知识组织是什么？',
    '知识组织',
    '清华校友会的可喻之义',
    '大学科研服务组织',
    '清华人文教育的发展脉络',
    'What is knowledge organization in university research services?',
    '清华文科复建和大学改革有什么关系？',
    '清华周刊中的学生自治',
    '新闻学院 思想亚洲 全球治理',
    '隐性知识显性化在组织中的作用',
    '教育学院研究生教育成果奖',
    '清华人文大展 校园文化 学生工作',
  ],
};

const REWRITE_SPEC_OVERRIDES: Record<
  string,
  Pick<RewriteSpec, 'mode' | 'multilingualProfile' | 'englishProfile'>
> = {
  sci_search: { mode: 'english' },
  patent_search: { mode: 'english' },
  green_deal_search: { mode: 'english', englishProfile: 'green_deal_regulatory' },
  report_search: { mode: 'multilingual', multilingualProfile: 'report' },
};

const JUDGMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    judgments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          candidate_score: { type: 'integer', minimum: 0, maximum: 4 },
          baseline_score: { type: 'integer', minimum: 0, maximum: 4 },
          winner: {
            type: 'string',
            enum: ['candidate', 'baseline', 'tie', 'both_bad'],
          },
          reason: { type: 'string' },
        },
        required: ['query', 'candidate_score', 'baseline_score', 'winner', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['judgments'],
  additionalProperties: false,
};

function parseCliOptions(): CliOptions {
  const args = new Set(Deno.args);
  if (args.has('--help')) {
    console.log(`Usage:
  deno run --allow-env --allow-net --allow-read --allow-write --config supabase/functions/deno.json scripts/eval_query_rewrite_models.ts [options]

Options:
  --dry-run                  Run 5 total queries once per model and include optional candidates.
  --limit=N                  Limit total source queries before repeats.
  --repeats=N                Repeat each query N times. Default: 3.
  --models=a,b               Candidate ids or model names to run. Must include gpt-4.1-mini.
  --include-optional         Include optional candidates such as gpt-5.4-nano-none.
  --judge-model=MODEL        LLM judge model. Default: gpt-4.1-mini.
  --output-prefix=PATH       Report path prefix. Default: /tmp/tiangong-eval/query-rewrite-model-eval-<timestamp>.
`);
    Deno.exit(0);
  }

  const getValue = (name: string) => {
    const prefix = `--${name}=`;
    return Deno.args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };

  const dryRun = args.has('--dry-run');
  const limitArg = getValue('limit');
  const repeatsArg = getValue('repeats');
  const modelsArg = getValue('models');

  return {
    dryRun,
    limit: dryRun ? 5 : limitArg ? Number(limitArg) : null,
    repeats: dryRun ? 1 : repeatsArg ? Number(repeatsArg) : 3,
    includeOptional: args.has('--include-optional') || dryRun,
    judgeModel: getValue('judge-model') ?? 'gpt-4.1-mini',
    outputPrefix: getValue('output-prefix') ?? DEFAULT_OUTPUT_PREFIX,
    models: modelsArg ? new Set(modelsArg.split(',').map((model) => model.trim())) : null,
  };
}

function selectCandidates(options: CliOptions) {
  return CANDIDATES.filter((candidate) => {
    if (candidate.optional && !options.includeOptional) {
      return false;
    }
    return (
      !options.models || options.models.has(candidate.id) || options.models.has(candidate.model)
    );
  });
}

function toRewriteSpecs(): RewriteSpec[] {
  const searchSpecs = FUNCTION_SPECS.filter((spec) => spec.kind === 'search').map(
    (spec: FunctionSpec): RewriteSpec => ({
      name: spec.name,
      queries: spec.queries,
      mode: REWRITE_SPEC_OVERRIDES[spec.name]?.mode ?? 'multilingual',
      multilingualProfile: REWRITE_SPEC_OVERRIDES[spec.name]?.multilingualProfile,
      englishProfile: REWRITE_SPEC_OVERRIDES[spec.name]?.englishProfile,
    }),
  );

  return [...searchSpecs, COURSE_SPEC];
}

function applyQueryLimit(specs: RewriteSpec[], limit: number | null) {
  if (!limit || !Number.isFinite(limit) || limit <= 0) {
    return specs;
  }

  const flattened = specs.flatMap((spec) => spec.queries.map((query) => ({ spec, query })));
  return flattened.slice(0, limit).reduce<RewriteSpec[]>((accumulator, item) => {
    const existing = accumulator.find((spec) => spec.name === item.spec.name);
    if (existing) {
      existing.queries.push(item.query);
    } else {
      accumulator.push({ ...item.spec, queries: [item.query] });
    }
    return accumulator;
  }, []);
}

function repeatSpecs(specs: RewriteSpec[], repeats: number) {
  const safeRepeats = Number.isFinite(repeats) && repeats > 0 ? Math.floor(repeats) : 1;
  return specs.map((spec) => ({
    ...spec,
    queries: Array.from({ length: safeRepeats }, () => spec.queries).flat(),
  }));
}

function getRewriteRequest(spec: RewriteSpec, query: string) {
  if (spec.mode === 'english') {
    const profile = spec.englishProfile ?? 'default';
    const useAliasSchema = profile !== 'default';
    return {
      schemaName: useAliasSchema
        ? `english_query_pack_generation_${profile}`
        : 'english_query_pack_generation',
      schema: useAliasSchema ? englishQueryWithAliasesSchema : englishQuerySchema,
      systemPrompt: buildEnglishQuerySystemPrompt({ profile }),
      userPrompt: `Original query: ${query}`,
      sanitize: (raw: unknown) => sanitizeEnglishQueryPack(raw as EnglishQueryPack, query),
    };
  }

  const profile = spec.multilingualProfile ?? 'default';
  const useAliasSchema = profile !== 'default';
  return {
    schemaName: useAliasSchema
      ? `search_query_pack_generation_${profile}`
      : 'search_query_pack_generation',
    schema: useAliasSchema ? multilingualQueryWithAliasesSchema : multilingualQuerySchema,
    systemPrompt: buildMultilingualQuerySystemPrompt({ profile }),
    userPrompt: `Original query: ${query}`,
    sanitize: (raw: unknown) => sanitizeMultilingualQueryPack(raw as QueryPack, query),
  };
}

function extractOutputText(response: unknown) {
  if (!response || typeof response !== 'object') {
    return '';
  }

  const record = response as Record<string, unknown>;
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text.trim();
  }

  const output = record.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content =
        item && typeof item === 'object' ? (item as Record<string, unknown>).content : null;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (
          part &&
          typeof part === 'object' &&
          typeof (part as Record<string, unknown>).text === 'string'
        ) {
          return String((part as Record<string, unknown>).text).trim();
        }
      }
    }
  }

  return '';
}

function stripCodeFence(text: string) {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? text.trim();
}

function parseJsonText(text: string) {
  const normalized = stripCodeFence(text);
  try {
    return JSON.parse(normalized);
  } catch (_error) {
    const objectStart = normalized.indexOf('{');
    const objectEnd = normalized.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(normalized.slice(objectStart, objectEnd + 1));
    }
    throw new Error('OpenAI output is not valid JSON');
  }
}

function readUsageTokens(response: unknown) {
  const usage =
    response && typeof response === 'object'
      ? ((response as Record<string, unknown>).usage as Record<string, unknown> | undefined)
      : undefined;

  return {
    inputTokens: Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0),
    outputTokens: Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0),
  };
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function runRewrite(
  candidate: Candidate,
  spec: RewriteSpec,
  query: string,
): Promise<RewriteRun> {
  const startedAt = performance.now();
  const request = getRewriteRequest(spec, query);

  try {
    const client = getOpenAIClient() as unknown as {
      responses?: { create?: (args: unknown) => Promise<unknown> };
    };
    if (!client.responses?.create) {
      throw new Error('OpenAI SDK missing responses.create');
    }

    const response = await client.responses.create({
      model: candidate.model,
      temperature: 0,
      input: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      ...(candidate.reasoningEffort ? { reasoning: { effort: candidate.reasoningEffort } } : {}),
      text: {
        format: {
          type: 'json_schema',
          name: request.schemaName,
          schema: request.schema,
          strict: true,
        },
      },
    });

    const outputText = extractOutputText(response);
    const raw = parseJsonText(outputText);
    const sanitized = request.sanitize(raw);
    const usage = readUsageTokens(response);
    const inputTokens =
      usage.inputTokens || estimateTokens(`${request.systemPrompt}\n${request.userPrompt}`);
    const outputTokens = usage.outputTokens || estimateTokens(outputText);
    const costUsd =
      (inputTokens * candidate.inputPricePerMillion +
        outputTokens * candidate.outputPricePerMillion) /
      1_000_000;

    return {
      query,
      ok: true,
      sanitized,
      normalized: JSON.stringify(sanitized),
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens,
      outputTokens,
      costUsd,
    };
  } catch (error) {
    return {
      query,
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function evaluateCandidate(candidate: Candidate, specs: RewriteSpec[]) {
  const runs: RewriteRun[] = [];

  for (const spec of specs) {
    for (const query of spec.queries) {
      console.log(`[${candidate.id}] ${spec.name}: ${query}`);
      runs.push(await runRewrite(candidate, spec, query));
    }
  }

  const firstError = runs.find((run) => !run.ok)?.error;
  return {
    candidate,
    runs,
    compatibilityError: runs.every((run) => !run.ok) ? firstError : undefined,
  } satisfies ModelEvaluation;
}

function toComparableRows(
  baseline: ModelEvaluation,
  candidate: ModelEvaluation,
  specs: RewriteSpec[],
) {
  const rows: Array<{
    function_name: string;
    query: string;
    baseline: string;
    candidate: string;
    candidate_error?: string;
  }> = [];
  let offset = 0;

  for (const spec of specs) {
    for (const query of spec.queries) {
      const baselineRun = baseline.runs[offset];
      const candidateRun = candidate.runs[offset];
      rows.push({
        function_name: spec.name,
        query,
        baseline: baselineRun?.normalized ?? baselineRun?.error ?? 'missing baseline',
        candidate: candidateRun?.normalized ?? candidateRun?.error ?? 'missing candidate',
        ...(candidateRun?.error ? { candidate_error: candidateRun.error } : {}),
      });
      offset += 1;
    }
  }

  return rows;
}

async function judgeCandidate(
  baseline: ModelEvaluation,
  candidate: ModelEvaluation,
  specs: RewriteSpec[],
  judgeModel: string,
) {
  if (candidate.candidate.id === baseline.candidate.id || candidate.compatibilityError) {
    return [];
  }

  const rows = toComparableRows(baseline, candidate, specs).filter((row) => !row.candidate_error);
  if (rows.length === 0) {
    return [];
  }

  const raw = await runStructuredOpenAITask<{ judgments: ModelJudgment[] }>({
    model: judgeModel,
    schemaName: `query_rewrite_model_eval_${candidate.candidate.id.replaceAll('.', '_')}`,
    schema: JUDGMENT_SCHEMA,
    temperature: 0,
    systemPrompt:
      'You evaluate query rewrite outputs for retrieval. Compare CANDIDATE against BASELINE. Prefer outputs that preserve the original scope, keep named entities and constraints, avoid invented facts, avoid answer-like prose, and produce concise retrieval-ready phrases. Score each side from 0 to 4. Use winner=candidate only when candidate is clearly better, winner=baseline only when baseline is clearly better, tie when equivalent, and both_bad when both are poor.',
    userPrompt: JSON.stringify(rows),
  });

  return raw.judgments;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarizeEvaluation(
  evaluation: ModelEvaluation,
  judgments: ModelJudgment[],
  baselineAverageQuality: number,
): CandidateSummary {
  const okRuns = evaluation.runs.filter((run) => run.ok);
  const jsonValidityRate =
    evaluation.runs.length === 0 ? 0 : okRuns.length / evaluation.runs.length;
  const avgQuality =
    evaluation.candidate.id === BASELINE_ID
      ? baselineAverageQuality
      : judgments.length > 0
        ? judgments.reduce((sum, item) => sum + item.candidate_score, 0) / judgments.length
        : 0;
  const baselineAvg =
    judgments.length > 0
      ? judgments.reduce((sum, item) => sum + item.baseline_score, 0) / judgments.length
      : baselineAverageQuality;
  const rejectionReasons: string[] = [];

  if (evaluation.compatibilityError) {
    rejectionReasons.push(`Compatibility failure: ${evaluation.compatibilityError}`);
  }
  if (jsonValidityRate < 1) {
    rejectionReasons.push('JSON/schema validity below 100%.');
  }
  if (evaluation.candidate.id !== BASELINE_ID && avgQuality < baselineAvg * 0.95) {
    rejectionReasons.push('Average quality is more than 5% below baseline.');
  }

  return {
    id: evaluation.candidate.id,
    model: evaluation.candidate.model,
    status:
      rejectionReasons.length === 0
        ? 'ok'
        : evaluation.compatibilityError
          ? 'incompatible'
          : 'rejected',
    queries: evaluation.runs.length,
    ok: okRuns.length,
    json_validity_rate: Number(jsonValidityRate.toFixed(4)),
    schema_validity_rate: Number(jsonValidityRate.toFixed(4)),
    avg_quality: Number(avgQuality.toFixed(3)),
    baseline_avg_quality: Number(baselineAvg.toFixed(3)),
    p50_latency_ms: percentile(
      okRuns.map((run) => run.latencyMs),
      50,
    ),
    p90_latency_ms: percentile(
      okRuns.map((run) => run.latencyMs),
      90,
    ),
    p95_latency_ms: percentile(
      okRuns.map((run) => run.latencyMs),
      95,
    ),
    total_cost_usd: Number(okRuns.reduce((sum, run) => sum + run.costUsd, 0).toFixed(6)),
    combined_score: 0,
    rejection_reasons: rejectionReasons,
  };
}

function applyCombinedScores(summaries: CandidateSummary[]) {
  const eligible = summaries.filter((summary) => summary.status === 'ok');
  const bestLatency = Math.min(...eligible.map((summary) => summary.p50_latency_ms || Infinity));
  const bestCost = Math.min(...eligible.map((summary) => summary.total_cost_usd || Infinity));
  const baselineQuality =
    summaries.find((summary) => summary.id === BASELINE_ID)?.avg_quality ||
    Math.max(...eligible.map((summary) => summary.avg_quality));

  for (const summary of summaries) {
    if (summary.status !== 'ok') {
      summary.combined_score = 0;
      continue;
    }

    const qualityScore =
      baselineQuality > 0 ? Math.min(1.1, summary.avg_quality / baselineQuality) : 0;
    const latencyScore =
      summary.p50_latency_ms > 0 && Number.isFinite(bestLatency)
        ? Math.min(1, bestLatency / summary.p50_latency_ms)
        : 0;
    const costScore =
      summary.total_cost_usd > 0 && Number.isFinite(bestCost)
        ? Math.min(1, bestCost / summary.total_cost_usd)
        : 0;

    summary.combined_score = Number(
      (qualityScore * 0.5 + latencyScore * 0.25 + costScore * 0.25).toFixed(4),
    );
  }
}

function pickWinner(summaries: CandidateSummary[]) {
  return summaries
    .filter((summary) => summary.status === 'ok')
    .sort((a, b) => {
      if (b.combined_score !== a.combined_score) {
        return b.combined_score - a.combined_score;
      }
      return a.total_cost_usd - b.total_cost_usd;
    })[0];
}

function toMarkdown(report: {
  generated_at: string;
  specs: Array<{ name: string; queries: number; mode: RewriteMode }>;
  summaries: CandidateSummary[];
  winner?: CandidateSummary;
  judgments: Record<string, ModelJudgment[]>;
}) {
  const table = [
    '| Model | Status | Quality | Baseline | p50 ms | p95 ms | Cost USD | Score |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.summaries.map(
      (summary) =>
        `| ${summary.id} | ${summary.status} | ${summary.avg_quality} | ${summary.baseline_avg_quality} | ${summary.p50_latency_ms} | ${summary.p95_latency_ms} | ${summary.total_cost_usd} | ${summary.combined_score} |`,
    ),
  ].join('\n');

  const regressions = Object.entries(report.judgments)
    .flatMap(([model, judgments]) =>
      judgments
        .filter((judgment) => judgment.winner === 'baseline')
        .slice(0, 3)
        .map((judgment) => `- ${model}: ${judgment.query} - ${judgment.reason}`),
    )
    .join('\n');

  return `# Query Rewrite Model Evaluation

Generated at: ${report.generated_at}

Recommended model: ${report.winner?.id ?? 'none'}

${table}

## Coverage

${report.specs.map((spec) => `- ${spec.name}: ${spec.queries} ${spec.mode} queries`).join('\n')}

## Top Regressions

${regressions || 'No candidate regressions recorded.'}

## Notes

- GPT-5-family candidates with \`reasoning.effort=none\` are evaluated by actual API compatibility. Incompatible models are rejected.
- Production \`OPENAI_CHAT_MODEL\` is not changed by this script.
`;
}

async function main() {
  const options = parseCliOptions();
  const candidates = selectCandidates(options);
  if (!candidates.some((candidate) => candidate.id === BASELINE_ID)) {
    throw new Error(`Candidate set must include baseline ${BASELINE_ID}.`);
  }

  const specs = repeatSpecs(applyQueryLimit(toRewriteSpecs(), options.limit), options.repeats);
  const queryCount = specs.reduce((sum, spec) => sum + spec.queries.length, 0);
  console.log(`Evaluating ${candidates.length} models over ${queryCount} rewrite requests.`);

  const evaluations: ModelEvaluation[] = [];
  for (const candidate of candidates) {
    evaluations.push(await evaluateCandidate(candidate, specs));
  }

  const baseline = evaluations.find((evaluation) => evaluation.candidate.id === BASELINE_ID);
  if (!baseline) {
    throw new Error(`Missing baseline evaluation for ${BASELINE_ID}.`);
  }

  const judgments: Record<string, ModelJudgment[]> = {};
  for (const evaluation of evaluations) {
    judgments[evaluation.candidate.id] = await judgeCandidate(
      baseline,
      evaluation,
      specs,
      options.judgeModel,
    );
  }

  const baselineAverageQuality = 4;
  const summaries = evaluations.map((evaluation) =>
    summarizeEvaluation(
      evaluation,
      judgments[evaluation.candidate.id] ?? [],
      baselineAverageQuality,
    ),
  );
  applyCombinedScores(summaries);
  const winner = pickWinner(summaries);
  const reportOptions = {
    dryRun: options.dryRun,
    limit: options.limit,
    repeats: options.repeats,
    includeOptional: options.includeOptional,
    judgeModel: options.judgeModel,
    outputPrefix: options.outputPrefix,
    models: options.models ? [...options.models] : null,
  };

  const report = {
    generated_at: new Date().toISOString(),
    options: reportOptions,
    specs: specs.map((spec) => ({
      name: spec.name,
      mode: spec.mode,
      queries: spec.queries.length,
    })),
    candidates,
    summaries,
    winner,
    judgments,
    evaluations,
    suggested_openai_chat_model: winner?.status === 'ok' ? winner.model : BASELINE_ID,
    gpt5_reasoning_none_note:
      'OpenAI Responses API docs state that reasoning.effort=none is supported for GPT-5.1 and later; this script records API compatibility for GPT-5-family candidates instead of assuming support.',
  };

  const slashIndex = options.outputPrefix.lastIndexOf('/');
  const outputDir = slashIndex >= 0 ? options.outputPrefix.slice(0, slashIndex) || '/' : '.';
  await Deno.mkdir(outputDir, { recursive: true });
  const jsonPath = `${options.outputPrefix}.json`;
  const markdownPath = `${options.outputPrefix}.md`;
  await Deno.writeTextFile(jsonPath, JSON.stringify(report, null, 2));
  await Deno.writeTextFile(markdownPath, toMarkdown(report));

  console.log('\n=== Query rewrite model evaluation ===');
  console.log(
    JSON.stringify(
      {
        winner: winner?.id ?? null,
        suggested_openai_chat_model: report.suggested_openai_chat_model,
        summaries,
        jsonPath,
        markdownPath,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  await main();
}
