import generateQuery from '../supabase/functions/_shared/generate_query.ts';
import generateQueryEn from '../supabase/functions/_shared/generate_query_en.ts';
import { getOpenAIClient } from '../supabase/functions/_shared/openai_client.ts';
import { generateEmbedding } from '../supabase/functions/_shared/openai_embedding.ts';
import { generateOntologyTuples } from '../supabase/functions/_shared/openai_generation.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

// Exercise actual callers and SDK capability selection without sending network requests.
Deno.test(
  'query profiles send none/low through Responses and Chat; generation is isolated',
  async () => {
    const names = [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_CHAT_MODEL',
      'OPENAI_QUERY_REWRITE_MODEL',
      'OPENAI_EMBEDDING_MODEL',
    ];
    const saved = names.map((name) => Deno.env.get(name));
    Deno.env.set('OPENAI_API_KEY', 'offline-query-rewrite-test');
    Deno.env.delete('OPENAI_BASE_URL');
    Deno.env.set('OPENAI_CHAT_MODEL', 'gpt-5.4-nano');
    Deno.env.set('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
    const client = getOpenAIClient() as unknown as {
      responses: { create: (body: any) => Promise<any> } | undefined;
      chat: { completions: { create: (body: any) => Promise<any> } };
      embeddings: { create: (body: any) => Promise<any> };
    };
    const originalResponses = client.responses;
    const originalChatCreate = client.chat.completions.create;
    const originalEmbeddingCreate = client.embeddings.create;
    let body: any;
    const produce = async (request: any) => {
      body = request;
      const schema = request.text?.format?.schema ?? request.response_format.json_schema.schema;
      const pack = Object.fromEntries(
        Object.keys(schema.properties).map((key) => [
          key,
          key.startsWith('lexical_aliases') || key === 'tuples'
            ? []
            : key.endsWith('_en')
              ? null
              : '污水处理厂脱氮除磷',
        ]),
      );
      const output = JSON.stringify(pack);
      return request.input
        ? { output_text: output }
        : { choices: [{ message: { content: output } }] };
    };
    try {
      for (const api of ['responses', 'chat']) {
        client.responses = api === 'responses' ? { create: produce } : undefined;
        client.chat.completions.create = produce;
        Deno.env.delete('OPENAI_QUERY_REWRITE_MODEL');
        const profiles = [
          {
            run: () => generateQuery('污水处理厂脱氮除磷'),
            name: 'search_query_pack_generation',
            fields: 4,
          },
          {
            run: () => generateQuery('污水处理厂脱氮除磷', { profile: 'report' }),
            name: 'search_query_pack_generation_report',
            fields: 6,
          },
          {
            run: () => generateQueryEn('wastewater nitrogen removal'),
            name: 'english_query_pack_generation',
            fields: 2,
          },
          {
            run: () => generateQueryEn('battery recycling', { profile: 'green_deal_regulatory' }),
            name: 'english_query_pack_generation_green_deal_regulatory',
            fields: 3,
          },
        ];
        for (const profile of profiles) {
          await profile.run();
          assert(body.model === 'gpt-6-luna', `${api}: query model leaked from generic generation`);
          assert(
            (body.reasoning?.effort ?? body.reasoning_effort) === 'none',
            `${api}: missing none`,
          );
          assert((body.text?.verbosity ?? body.verbosity) === 'low', `${api}: missing low`);
          const format = body.text?.format ?? body.response_format.json_schema;
          assert(
            format.name === profile.name && format.strict === true,
            `${api}: schema/profile drift`,
          );
          assert(format.schema.required.length === profile.fields, `${api}: required fields drift`);
          assert(
            body.max_output_tokens === undefined && body.max_completion_tokens === undefined,
            'unexpected global output cap',
          );
        }
        Deno.env.set('OPENAI_QUERY_REWRITE_MODEL', ' gpt-5.4-nano ');
        await generateQuery('污水处理厂脱氮除磷');
        assert(body.model === 'gpt-5.4-nano', `${api}: query-only rollback override ignored`);
        Deno.env.set('OPENAI_QUERY_REWRITE_MODEL', 'gpt-6-luna');
        await generateOntologyTuples('nitrogen removal', 'wastewater treatment');
        assert(body.model === 'gpt-5.4-nano', `${api}: generation model changed`);
        assert(
          body.reasoning === undefined && body.reasoning_effort === undefined,
          `${api}: generation received query reasoning`,
        );
        assert(
          body.text?.verbosity === undefined && body.verbosity === undefined,
          `${api}: generation received query verbosity`,
        );
      }
      client.embeddings.create = async (request) => {
        body = request;
        return { data: [{ embedding: [0.1, 0.2] }] };
      };
      await generateEmbedding('wastewater treatment');
      assert(body.model === 'text-embedding-3-small', 'embedding model changed');
    } finally {
      client.responses = originalResponses;
      client.chat.completions.create = originalChatCreate;
      client.embeddings.create = originalEmbeddingCreate;
      names.forEach((name, index) =>
        saved[index] === undefined ? Deno.env.delete(name) : Deno.env.set(name, saved[index]!),
      );
    }
  },
);
