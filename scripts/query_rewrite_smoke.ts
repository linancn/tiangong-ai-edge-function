import generateQuery from '../supabase/functions/_shared/generate_query.ts';
import generateQueryEn from '../supabase/functions/_shared/generate_query_en.ts';
import { getOpenAIClient } from '../supabase/functions/_shared/openai_client.ts';

const fixtures = [
  {
    id: 'multilingual-default',
    query: '污水处理厂脱氮除磷',
    run: generateQuery,
    checks: [/污水处理厂/, /脱氮/, /除磷/],
  },
  {
    id: 'standard-edition-exclusion',
    query: 'GB/T 24040-2008 生命周期评价原则与框架，不含生命周期影响评价方法',
    run: generateQuery,
    checks: [/GB\/?T\s*24040[-–—]2008/i, /(?:不含|不包括|排除)生命周期影响评价方法/],
  },
  {
    id: 'unknown-identifier-exclusion',
    query: 'XQZ-17 催化剂，不含铂',
    run: generateQuery,
    checks: [/XQZ-17/, /(?:不含|无|不包含)铂/],
  },
  {
    id: 'multilingual-report',
    query: 'coastal floods and sandy coastline recession are projected to increase',
    run: (query: string) => generateQuery(query, { profile: 'report' }),
    checks: [
      /(?:海岸|沿海|coastal)/i,
      /(?:洪水|flood)/i,
      /(?:沙质|sandy)/i,
      /(?:退缩|后退|recession|retreat)/i,
    ],
  },
  {
    id: 'english-default',
    query: 'dichloromethane CAS 75-09-2 emissions excluding chloroform',
    run: generateQueryEn,
    checks: [/dichloromethane/i, /75-09-2/, /(?:excluding|without|not including)\s+chloroform/i],
  },
  {
    id: 'english-regulatory',
    query:
      'What is the relationship between Regulation (EU) 2023/1542 and the Circular Economy Action Plan?',
    run: (query: string) => generateQueryEn(query, { profile: 'green_deal_regulatory' }),
    checks: [/2023\/1542/, /Circular Economy Action Plan/i],
  },
];

// Six fixed cases, no judge, no candidate matrix, and no provider retries.
async function main() {
  const live = Deno.args.includes('--live');
  const output = Deno.args.find((arg) => arg.startsWith('--output='))?.slice(9);
  if (Deno.args.some((arg) => arg !== '--live' && !arg.startsWith('--output='))) {
    throw new Error('Usage: query_rewrite_smoke.ts [--live] [--output=/tmp/report.json]');
  }
  if (!live) {
    console.log(
      JSON.stringify(
        {
          live: false,
          calls: fixtures.length,
          fixtures: fixtures.map(({ id, query }) => ({ id, query })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const client = getOpenAIClient(Deno.env.get('OPENAI_BASE_URL') || undefined);
  const create = client.responses.create.bind(client.responses);
  let receipt: any;
  let rawPack: any;
  client.responses.create = (async (body: any) => {
    const response = await create(body, { maxRetries: 0, timeout: 20000 });
    receipt = {
      requestedModel: body.model,
      model: response.model,
      reasoning: body.reasoning,
      verbosity: body.text?.verbosity,
      status: response.status,
      usage: response.usage,
    };
    if (
      response.status !== 'completed' ||
      !(response.model === body.model || response.model.startsWith(`${body.model}-`)) ||
      body.reasoning?.effort !== 'none' ||
      body.text?.verbosity !== 'low' ||
      response.usage?.output_tokens_details?.reasoning_tokens !== 0
    ) {
      throw new Error(
        'Provider receipt does not confirm the requested model/none/low configuration',
      );
    }
    rawPack = JSON.parse(response.output_text);
    const properties = body.text.format.schema.properties;
    const keys = Object.keys(rawPack);
    if (
      keys.length !== Object.keys(properties).length ||
      keys.some((key) => !(key in properties))
    ) {
      throw new Error('Raw rewrite output does not match required schema fields');
    }
    for (const [key, definition] of Object.entries(properties) as Array<[string, any]>) {
      const value = rawPack[key];
      const types = Array.isArray(definition.type) ? definition.type : [definition.type];
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      if (
        !types.includes(type) ||
        (type === 'array' && value.some((item: unknown) => typeof item !== 'string'))
      ) {
        throw new Error(`Invalid raw rewrite field type: ${key}`);
      }
    }
    return response;
  }) as typeof client.responses.create;
  const results = [];
  try {
    for (const fixture of fixtures) {
      const started = performance.now();
      try {
        const pack = await fixture.run(fixture.query);
        const failures = [];
        for (const [stage, value] of [
          ['raw', rawPack],
          ['sanitized', pack],
        ] as const) {
          for (const field of ['semantic_query', 'lexical_query']) {
            const text = value[field].replace(/\s+/g, '');
            for (const check of fixture.checks) {
              // Keep spaces for English phrase constraints and also accept normalized Chinese spacing.
              if (!check.test(value[field]) && !check.test(text))
                failures.push(`${stage}.${field}: ${check.source}`);
            }
          }
        }
        for (const key of ['lexical_aliases', 'lexical_aliases_en']) {
          const aliases = (pack as any)[key];
          if (aliases && aliases.length > 2) failures.push(`${key}: more than two aliases`);
        }
        results.push({
          id: fixture.id,
          query: fixture.query,
          passed: failures.length === 0,
          failures,
          raw: rawPack,
          sanitized: pack,
          receipt,
          latencyMs: Math.round(performance.now() - started),
        });
      } catch (error) {
        results.push({
          id: fixture.id,
          passed: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      console.log(JSON.stringify(results.at(-1)));
    }
  } finally {
    client.responses.create = create as typeof client.responses.create;
  }
  const report = {
    kind: 'integration-smoke',
    comparativeBenchmark: false,
    date: new Date().toISOString(),
    passed: results.every((result) => result.passed),
    results,
  };
  if (output) await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) Deno.exitCode = 1;
}

if (import.meta.main) await main();
