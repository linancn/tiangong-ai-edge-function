import { runStructuredOpenAITask } from '../supabase/functions/_shared/openai_structured_task.ts';

type FunctionKind = 'search' | 'graph_search' | 'graph_generate';

interface FunctionSpec {
  name: string;
  kind: FunctionKind;
  queries: string[];
}

interface QueryRunResult {
  query: string;
  normalized: string;
  rawType: string;
}

interface QueryJudgment {
  query: string;
  winner: 'current' | 'baseline' | 'tie' | 'both_bad';
  current_score: number;
  baseline_score: number;
  reason: string;
}

interface FunctionEvaluation {
  name: string;
  judgments: QueryJudgment[];
  currentResults: QueryRunResult[];
  baselineResults: QueryRunResult[];
}

const CURRENT_WORKDIR = Deno.cwd();
const BASELINE_WORKDIR = '/tmp/tiangong-eval/baseline';
const SERVER_URL = 'http://127.0.0.1:8000/';

const QUERY_TOP_K = 3;
const QUERY_EXT_K = 1;
const GRAPH_ROOT = 1;
const GRAPH_DEPTH = 2;
const QUERY_CONCURRENCY = 3;

const JUDGMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    judgments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          winner: {
            type: 'string',
            enum: ['current', 'baseline', 'tie', 'both_bad'],
          },
          current_score: {
            type: 'integer',
            minimum: 0,
            maximum: 4,
          },
          baseline_score: {
            type: 'integer',
            minimum: 0,
            maximum: 4,
          },
          reason: { type: 'string' },
        },
        required: ['query', 'winner', 'current_score', 'baseline_score', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['judgments'],
  additionalProperties: false,
};

const FUNCTION_SPECS: FunctionSpec[] = [
  {
    name: 'green_deal_search',
    kind: 'search',
    queries: [
      '欧盟新电池法规和循环经济行动计划有什么关系？',
      'What is the relationship between the EU Battery Regulation and the Circular Economy Action Plan?',
      '欧盟新电池法规对电池回收有什么影响？',
      'What is the impact of the EU Battery Regulation on battery recycling?',
      '欧盟电池法规适用于哪些电池？',
      'What batteries are covered by the EU Battery Regulation?',
      '欧盟电池法规碳足迹要求什么时候生效？',
      'When do the EU Battery Regulation carbon footprint requirements take effect?',
      '欧盟电池法规对再生材料有什么要求？',
      'What are the recycled content requirements in the EU Battery Regulation?',
      '欧盟电池法规中的尽职调查要求是什么？',
      'What are the due diligence requirements in the EU Battery Regulation?',
      '电池护照在欧盟电池法规里是什么？',
      'What is the battery passport in the EU Battery Regulation?',
      '欧盟关键原材料行动计划的目标是什么？',
      'What are the objectives of the Critical Raw Materials Action Plan?',
      '零污染行动计划和电池法规有什么联系？',
      'How does the Zero Pollution Action Plan relate to the EU Battery Regulation?',
      '可持续产品倡议和电池法规有什么关系？',
      'How does the Sustainable Products Initiative relate to the EU Battery Regulation?',
    ],
  },
  {
    name: 'standard_search',
    kind: 'search',
    queries: [
      '二氧化硫一级浓度限值是多少？',
      'sulfur dioxide primary concentration limit',
      '环境空气二氧化硫自动测定紫外荧光法',
      'ultraviolet fluorescence method for sulfur dioxide in ambient air',
      '固定污染源废气二氧化硫便携式紫外吸收法',
      'portable ultraviolet absorption method for sulfur dioxide in stationary source exhaust',
      '环境空气质量标准中二氧化硫限值',
      'sulfur dioxide limit in ambient air quality standard',
      '钢铁行业大气污染物排放标准',
      'air pollutant emission standard for iron and steel industry',
      '水质化学需氧量测定方法',
      'chemical oxygen demand determination method for water quality',
      '地表水环境质量标准总磷限值',
      'total phosphorus limit in surface water environmental quality standard',
      '挥发性有机物无组织排放控制标准',
      'standard for fugitive volatile organic compounds emissions',
      '恶臭污染物排放标准',
      'odor pollutant emission standard',
      '垃圾焚烧污染控制标准',
      'pollution control standard for municipal solid waste incineration',
    ],
  },
  {
    name: 'edu_search',
    kind: 'search',
    queries: [
      '污水处理厂脱氮除磷',
      'nitrogen and phosphorus removal in wastewater treatment plants',
      '滤层膨胀与反冲洗强度的关系',
      'relationship between filter layer expansion and backwashing intensity',
      '活性污泥法的基本原理',
      'basic principles of activated sludge process',
      '生物膜法和活性污泥法的区别',
      'difference between biofilm process and activated sludge process',
      '大气污染控制中的静电除尘',
      'electrostatic precipitation in air pollution control',
      '二沉池污泥膨胀原因',
      'causes of sludge bulking in secondary clarifiers',
      '脱硫脱硝工艺比较',
      'comparison of flue gas desulfurization and denitrification processes',
      '混凝沉淀的影响因素',
      'factors affecting coagulation and sedimentation',
      '臭氧高级氧化处理有机污染物',
      'ozone advanced oxidation for organic pollutant removal',
      '固体废物卫生填埋场渗滤液处理',
      'leachate treatment in sanitary landfills',
    ],
  },
  {
    name: 'textbook_search',
    kind: 'search',
    queries: [
      '如何减排二氧化碳？',
      'how to reduce carbon dioxide emissions',
      '水污染控制的基本思路',
      'basic approach to water pollution control',
      '大气污染治理技术有哪些',
      'air pollution control technologies',
      '固体废物资源化利用',
      'resource recovery from solid waste',
      '环境影响评价的基本流程',
      'basic steps of environmental impact assessment',
      '城市污水处理厂工艺选择',
      'process selection for municipal wastewater treatment plants',
      '垃圾焚烧发电的环境问题',
      'environmental issues of waste incineration power generation',
      '生态修复的主要方法',
      'major methods of ecological restoration',
      '清洁生产与循环经济',
      'cleaner production and circular economy',
      '噪声污染控制方法',
      'noise pollution control methods',
    ],
  },
  {
    name: 'esg_search',
    kind: 'search',
    queries: [
      '如何减排二氧化碳？',
      'how to reduce carbon emissions',
      '温室气体总排放量是多少？',
      'total greenhouse gas emissions',
      '公司的用水量和节水措施',
      'corporate water consumption and water-saving measures',
      '可再生能源使用比例',
      'share of renewable energy use',
      '废弃物回收与资源化利用',
      'waste recycling and resource recovery',
      '供应链碳排放管理',
      'supply chain carbon emissions management',
      '气候变化风险与机遇',
      'climate-related risks and opportunities',
      '范围一范围二排放',
      'scope 1 and scope 2 emissions',
      '环境绩效目标与进展',
      'environmental performance targets and progress',
      '绿色办公和节能措施',
      'green office and energy-saving measures',
    ],
  },
  {
    name: 'report_search',
    kind: 'search',
    queries: [
      'coastal floods and sandy coastline recession are projected to increase',
      '海岸洪水和沙质海岸线退缩的趋势',
      '亚洲气候变化对农业的影响',
      'climate change impacts on agriculture in Asia',
      '欧洲热浪与干旱风险',
      'heatwave and drought risks in Europe',
      'sea level rise impacts on coastal cities',
      '海平面上升对沿海城市的影响',
      '气候变化对水资源安全的影响',
      'climate change impacts on water security',
      'extreme precipitation events and flood risk',
      '极端降水和洪水风险',
      'climate adaptation in urban areas',
      '城市气候适应措施',
      'biodiversity loss under climate change',
      '气候变化下的生物多样性丧失',
      'food security under climate change',
      '气候变化与粮食安全',
      'wildfire risk under warming climate',
      '变暖背景下的野火风险',
    ],
  },
  {
    name: 'sci_search',
    kind: 'search',
    queries: [
      '关键金属物质流的全球贸易特征是什么？',
      'global trade characteristics of critical metal material flows',
      'lithium recycling and circular economy',
      '锂电池回收与循环经济',
      'carbon footprint of electric vehicle batteries',
      '电动汽车电池碳足迹',
      'urban mining of critical metals',
      '关键金属城市矿山',
      'industrial symbiosis and material flow analysis',
      '工业共生与物质流分析',
      'life cycle assessment of photovoltaic systems',
      '光伏系统生命周期评价',
      'wastewater nitrogen phosphorus removal review',
      '污水脱氮除磷研究',
      'plastic waste trade and policy',
      '塑料废弃物贸易与政策',
      'supply chain emissions embodied carbon',
      '供应链隐含碳排放',
      'rare earth material flow analysis',
      '稀土物质流分析',
    ],
  },
  {
    name: 'patent_search',
    kind: 'search',
    queries: [
      'Tunnel for high-speed vehicles',
      'tunnel ventilation energy recovery',
      'battery recycling equipment',
      '废旧电池回收装置',
      'wastewater treatment membrane module',
      '污水处理膜组件',
      'carbon capture device',
      '碳捕集装置',
      'solar panel cleaning system',
      '光伏板清洗系统',
      'landfill leachate treatment apparatus',
      '垃圾填埋场渗滤液处理设备',
      'flue gas desulfurization reactor',
      '烟气脱硫反应器',
      'electric vehicle battery thermal management',
      '电动汽车电池热管理',
      'air pollution monitoring sensor',
      '大气污染监测传感器',
      'plastic sorting machine',
      '塑料分选设备',
    ],
  },
  {
    name: 'internal_search',
    kind: 'search',
    queries: [
      '闲鱼如何减排二氧化碳？',
      'Xianyu carbon reduction strategy',
      '闲鱼循环经济价值',
      'circular economy value of Xianyu',
      '闲鱼品牌介绍',
      'Xianyu brand introduction',
      '闲鱼ESG项目',
      'Xianyu ESG initiatives',
      '二手交易平台的环保价值',
      'environmental value of second-hand marketplace',
      '阿里循环业务减碳',
      'Alibaba circular business carbon reduction',
      '闲鱼用户增长与绿色消费',
      'Xianyu green consumption and user growth',
      '以旧换新和回收',
      'trade-in and recycling',
      '平台碳减排案例',
      'platform carbon reduction case studies',
      '二手商品延长使用寿命',
      'extending product lifetime through second-hand markets',
    ],
  },
];

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateText(value: unknown, maxLength = 220): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) {
    return '';
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function responseTypeName(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function summarizeSearchResponse(value: unknown): string {
  if (!Array.isArray(value)) {
    return `Non-array response: ${truncateText(value, 600)}`;
  }

  if (value.length === 0) {
    return 'No results.';
  }

  return value
    .slice(0, 3)
    .map((item, index) => {
      const source = truncateText((item as Record<string, unknown>)?.source ?? '', 180);
      const content = truncateText((item as Record<string, unknown>)?.content ?? '', 220);
      return `${index + 1}. SOURCE: ${source}\nSNIPPET: ${content}`;
    })
    .join('\n');
}

function summarizeGraphPathItem(item: unknown): string {
  const record = item as Record<string, unknown>;
  const rawPath =
    (record?._fields as unknown[])?.[0] ??
    (record?.path as Record<string, unknown> | undefined) ??
    record;
  const path = rawPath as Record<string, unknown> | undefined;

  const start = (path?.start as Record<string, unknown> | undefined)?.properties as
    | Record<string, unknown>
    | undefined;
  const segments = (path?.segments as unknown[]) ?? [];
  const nodes: string[] = [];

  const startId = truncateText(start?.id ?? start?.name ?? '', 80);
  if (startId) {
    nodes.push(startId);
  }

  for (const segment of segments) {
    const endProps = (
      (segment as Record<string, unknown>)?.end as Record<string, unknown> | undefined
    )?.properties as Record<string, unknown> | undefined;
    const endId = truncateText(endProps?.id ?? endProps?.name ?? '', 80);
    if (endId) {
      nodes.push(endId);
    }
  }

  return nodes.length > 0 ? nodes.join(' -> ') : truncateText(item, 220);
}

function summarizeGraphSearchResponse(value: unknown): string {
  if (!Array.isArray(value)) {
    return `Non-array response: ${truncateText(value, 600)}`;
  }

  if (value.length === 0) {
    return 'No results.';
  }

  return value
    .slice(0, 5)
    .map((item, index) => `${index + 1}. PATH: ${summarizeGraphPathItem(item)}`)
    .join('\n');
}

function collectGraphNodes(
  node: Record<string, unknown> | undefined,
  out: string[],
  depth: number,
  maxDepth: number,
  maxNodes: number,
): void {
  if (!node || out.length >= maxNodes || depth > maxDepth) {
    return;
  }

  const name = truncateText(node.name ?? node.node_id ?? '', 80);
  const relations = Array.isArray(node.relations)
    ? (node.relations as unknown[])
        .map((relation) => truncateText(relation, 40))
        .filter(Boolean)
        .join(', ')
    : '';

  out.push(relations ? `${name} [${relations}]` : name);

  const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : [];
  for (const child of children) {
    collectGraphNodes(child, out, depth + 1, maxDepth, maxNodes);
    if (out.length >= maxNodes) {
      break;
    }
  }
}

function summarizeGraphGenerateResponse(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `Non-graph response: ${truncateText(value, 600)}`;
  }

  const nodes: string[] = [];
  collectGraphNodes(value as Record<string, unknown>, nodes, 0, 2, 12);
  return nodes.length > 0
    ? nodes.map((node, index) => `${index + 1}. NODE: ${node}`).join('\n')
    : 'Empty graph.';
}

function summarizeResponse(kind: FunctionKind, value: unknown): string {
  if (kind === 'graph_search') {
    return summarizeGraphSearchResponse(value);
  }

  if (kind === 'graph_generate') {
    return summarizeGraphGenerateResponse(value);
  }

  return summarizeSearchResponse(value);
}

function buildRequestBody(spec: FunctionSpec, query: string): Record<string, unknown> {
  if (spec.kind === 'graph_search' || spec.kind === 'graph_generate') {
    return {
      query,
      root: GRAPH_ROOT,
      depth: GRAPH_DEPTH,
    };
  }

  const body: Record<string, unknown> = {
    query,
    topK: QUERY_TOP_K,
  };

  if (spec.name !== 'patent_search') {
    body.extK = QUERY_EXT_K;
  }

  return body;
}

async function waitForServerReady(timeoutMs = 30000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(SERVER_URL, {
        method: 'OPTIONS',
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await sleep(400);
  }

  throw new Error('Timed out waiting for function server to become ready.');
}

async function startFunctionServer(
  workdir: string,
  functionName: string,
): Promise<Deno.ChildProcess> {
  const env = {
    ...Deno.env.toObject(),
  };

  const child = new Deno.Command('deno', {
    cwd: workdir,
    args: [
      'run',
      '--allow-all',
      '--config',
      'supabase/functions/deno.json',
      `supabase/functions/${functionName}/index.ts`,
    ],
    env,
    stdin: 'null',
    stdout: 'null',
    stderr: 'null',
  }).spawn();

  await waitForServerReady();
  return child;
}

async function stopFunctionServer(child: Deno.ChildProcess): Promise<void> {
  try {
    child.kill('SIGINT');
  } catch {
    // ignore
  }

  await Promise.race([
    child.status.catch(() => ({ success: false, code: -1, signal: 'SIGINT' as Deno.Signal })),
    sleep(3000),
  ]);

  try {
    child.kill('SIGKILL');
  } catch {
    // ignore
  }

  await sleep(500);
}

async function invokeFunction(
  spec: FunctionSpec,
  query: string,
  apiKey: string,
): Promise<QueryRunResult> {
  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(buildRequestBody(spec, query)),
      signal: AbortSignal.timeout(45000),
    });

    const text = await response.text();

    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as text
    }

    return {
      query,
      normalized: summarizeResponse(spec.kind, parsed),
      rawType: responseTypeName(parsed),
    };
  } catch (error) {
    return {
      query,
      normalized: `Request error: ${truncateText(error instanceof Error ? error.message : String(error), 300)}`,
      rawType: 'error',
    };
  }
}

async function collectResultsForVariant(
  spec: FunctionSpec,
  workdir: string,
  label: 'current' | 'baseline',
  apiKey: string,
): Promise<QueryRunResult[]> {
  console.log(`Starting ${label} server for ${spec.name}...`);
  const child = await startFunctionServer(workdir, spec.name);

  try {
    const results: QueryRunResult[] = new Array(spec.queries.length);
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;

        if (index >= spec.queries.length) {
          return;
        }

        const query = spec.queries[index];
        console.log(`[${spec.name}] ${label} ${index + 1}/${spec.queries.length}: ${query}`);
        results[index] = await invokeFunction(spec, query, apiKey);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(QUERY_CONCURRENCY, spec.queries.length) }, () => worker()),
    );

    return results;
  } finally {
    console.log(`Stopping ${label} server for ${spec.name}...`);
    await stopFunctionServer(child);
  }
}

async function judgeFunction(
  spec: FunctionSpec,
  currentResults: QueryRunResult[],
  baselineResults: QueryRunResult[],
): Promise<QueryJudgment[]> {
  const comparisons = spec.queries.map((query, index) => ({
    query,
    current_type: currentResults[index]?.rawType ?? 'unknown',
    current_results: currentResults[index]?.normalized ?? 'Missing current result.',
    baseline_type: baselineResults[index]?.rawType ?? 'unknown',
    baseline_results: baselineResults[index]?.normalized ?? 'Missing baseline result.',
  }));

  const raw = await runStructuredOpenAITask<{ judgments: QueryJudgment[] }>({
    schemaName: `retrieval_eval_${spec.name}`,
    schema: JUDGMENT_SCHEMA,
    fallbackModel: 'gpt-4o-mini',
    systemPrompt:
      'You evaluate retrieval quality for environmental-domain search functions. Compare CURRENT vs BASELINE results for each query. Prefer results whose top items are more directly relevant, more specific, and more likely to help answer the query. Use scores from 0 to 4. 0 means irrelevant or broken. 4 means very strong direct match. winner=current if current is clearly better, winner=baseline if baseline is clearly better, winner=tie if essentially the same quality, winner=both_bad if both are poor.',
    userPrompt: `Function: ${spec.name}\nCompare these query results in order and return one judgment per query.\n${JSON.stringify(comparisons)}`,
  });

  return raw.judgments;
}

function summarizeJudgments(judgments: QueryJudgment[]) {
  const summary = {
    improved: 0,
    worse: 0,
    tie: 0,
    both_bad: 0,
    current_score_sum: 0,
    baseline_score_sum: 0,
  };

  for (const judgment of judgments) {
    summary.current_score_sum += judgment.current_score;
    summary.baseline_score_sum += judgment.baseline_score;

    if (judgment.winner === 'current') {
      summary.improved += 1;
    } else if (judgment.winner === 'baseline') {
      summary.worse += 1;
    } else if (judgment.winner === 'tie') {
      summary.tie += 1;
    } else {
      summary.both_bad += 1;
    }
  }

  return {
    ...summary,
    current_avg:
      judgments.length > 0 ? Number((summary.current_score_sum / judgments.length).toFixed(2)) : 0,
    baseline_avg:
      judgments.length > 0 ? Number((summary.baseline_score_sum / judgments.length).toFixed(2)) : 0,
  };
}

function pickExamples(evaluation: FunctionEvaluation) {
  const improved = evaluation.judgments.filter((item) => item.winner === 'current').slice(0, 2);
  const worse = evaluation.judgments.filter((item) => item.winner === 'baseline').slice(0, 2);

  return {
    improved,
    worse,
  };
}

function printFunctionSummary(evaluation: FunctionEvaluation): void {
  const summary = summarizeJudgments(evaluation.judgments);
  const examples = pickExamples(evaluation);

  console.log(`\n=== ${evaluation.name} ===`);
  console.log(
    JSON.stringify(
      {
        improved: summary.improved,
        worse: summary.worse,
        tie: summary.tie,
        both_bad: summary.both_bad,
        current_avg: summary.current_avg,
        baseline_avg: summary.baseline_avg,
      },
      null,
      2,
    ),
  );

  if (examples.improved.length > 0) {
    console.log('Improved examples:');
    for (const item of examples.improved) {
      console.log(`- ${item.query}: ${item.reason}`);
    }
  }

  if (examples.worse.length > 0) {
    console.log('Worse examples:');
    for (const item of examples.worse) {
      console.log(`- ${item.query}: ${item.reason}`);
    }
  }
}

async function main() {
  const apiKey = requireEnv('X_API_KEY');
  const limitArg = Deno.args.find((argument) => argument.startsWith('--limit='));
  const queryLimit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const requestedFunctions = new Set(Deno.args.filter((argument) => argument !== limitArg));
  const specs =
    requestedFunctions.size > 0
      ? FUNCTION_SPECS.filter((spec) => requestedFunctions.has(spec.name))
      : FUNCTION_SPECS;

  if (specs.length === 0) {
    throw new Error('No matching function specs found for the provided arguments.');
  }

  const evaluations: FunctionEvaluation[] = [];

  for (const spec of specs) {
    const effectiveSpec =
      queryLimit && Number.isFinite(queryLimit) && queryLimit > 0
        ? { ...spec, queries: spec.queries.slice(0, queryLimit) }
        : spec;

    console.log(`Running ${effectiveSpec.name} with ${effectiveSpec.queries.length} queries...`);

    const currentResults = await collectResultsForVariant(
      effectiveSpec,
      CURRENT_WORKDIR,
      'current',
      apiKey,
    );
    const baselineResults = await collectResultsForVariant(
      effectiveSpec,
      BASELINE_WORKDIR,
      'baseline',
      apiKey,
    );
    console.log(`Judging ${effectiveSpec.name}...`);
    const judgments = await judgeFunction(effectiveSpec, currentResults, baselineResults);

    const evaluation: FunctionEvaluation = {
      name: effectiveSpec.name,
      judgments,
      currentResults,
      baselineResults,
    };

    evaluations.push(evaluation);
    printFunctionSummary(evaluation);
  }

  const reportPath = `/tmp/tiangong-eval/retrieval-eval-${Date.now()}.json`;
  await Deno.writeTextFile(reportPath, JSON.stringify(evaluations, null, 2));

  const overall = evaluations.reduce(
    (accumulator, evaluation) => {
      const summary = summarizeJudgments(evaluation.judgments);
      accumulator.improved += summary.improved;
      accumulator.worse += summary.worse;
      accumulator.tie += summary.tie;
      accumulator.both_bad += summary.both_bad;
      accumulator.current_score_sum += summary.current_score_sum;
      accumulator.baseline_score_sum += summary.baseline_score_sum;
      accumulator.count += evaluation.judgments.length;
      return accumulator;
    },
    {
      improved: 0,
      worse: 0,
      tie: 0,
      both_bad: 0,
      current_score_sum: 0,
      baseline_score_sum: 0,
      count: 0,
    },
  );

  console.log('\n=== Overall ===');
  console.log(
    JSON.stringify(
      {
        improved: overall.improved,
        worse: overall.worse,
        tie: overall.tie,
        both_bad: overall.both_bad,
        current_avg:
          overall.count > 0 ? Number((overall.current_score_sum / overall.count).toFixed(2)) : 0,
        baseline_avg:
          overall.count > 0 ? Number((overall.baseline_score_sum / overall.count).toFixed(2)) : 0,
        reportPath,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  await main();
}
