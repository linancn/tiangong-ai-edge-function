// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { Pinecone } from '@pinecone-database/pinecone';
import { createClient, SupabaseClient } from '@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import generateQuery from '../_shared/generate_query.ts';
import supabaseAuth from '../_shared/supabase_auth.ts';
import logInsert from '../_shared/supabase_function_log.ts';

const openai_api_key = Deno.env.get('OPENAI_API_KEY') ?? '';
const openai_embedding_model = Deno.env.get('OPENAI_EMBEDDING_MODEL') ?? '';

const pinecone_api_key = Deno.env.get('PINECONE_API_KEY_US_EAST_1') ?? '';
const pinecone_index_name = Deno.env.get('PINECONE_INDEX_NAME') ?? '';
const pinecone_namespace_esg = Deno.env.get('PINECONE_NAMESPACE_ESG') ?? '';

const opensearch_region = Deno.env.get('OPENSEARCH_REGION') ?? '';
const opensearch_domain = Deno.env.get('OPENSEARCH_DOMAIN') ?? '';
const opensearch_index_name = Deno.env.get('OPENSEARCH_ESG_INDEX_NAME') ?? '';

const supabase_url = Deno.env.get('LOCAL_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const supabase_anon_key =
  Deno.env.get('LOCAL_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const openaiClient = new OpenAIEmbeddings({
  apiKey: openai_api_key,
  model: openai_embedding_model,
});

const pc = new Pinecone({ apiKey: pinecone_api_key });
const index = pc.index(pinecone_index_name);

const opensearchClient = new Client({
  ...AwsSigv4Signer({
    region: opensearch_region,
    service: 'aoss',

    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    },
  }),
  node: opensearch_domain,
});

async function getStandardsMeta(supabase: SupabaseClient, meta_contains: string) {
  // console.log(full_text);
  const { data, error } = await supabase.rpc('esg_full_text', {
    meta_contains,
  });

  if (error) {
    console.error(error);
    return null;
  }
  // console.log(data);
  return data;
}

function formatTimestampToDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  return `${year}-${month}-${day}`;
}

type FilterType = { [field: string]: string[] };
type DateFilterType = { [field: string]: { gte?: number; lte?: number } };
type FiltersItem = {
  terms?: { [field: string]: string[] };
  range?: { [field: string]: { gte?: number; lte?: number } };
};
type FiltersType = FiltersItem[];

type PCFilter = {
  $and: Array<{ [field: string]: { $in?: string[]; $gte?: number; $lte?: number } }>;
};

function filterToPCQuery(filters: FiltersType): PCFilter {
  const andConditions = filters.flatMap((item) => {
    const conditions: Array<{ [field: string]: { $in?: string[]; $gte?: number; $lte?: number } }> =
      [];

    if (item.terms) {
      for (const field in item.terms) {
        conditions.push({
          [field]: {
            $in: item.terms[field],
          },
        });
      }
    }

    if (item.range) {
      for (const field in item.range) {
        const rangeConditions: { $gte?: number; $lte?: number } = {};
        if (item.range[field].gte) {
          rangeConditions.$gte = item.range[field].gte;
        }
        if (item.range[field].lte) {
          rangeConditions.$lte = item.range[field].lte;
        }
        conditions.push({
          [field]: rangeConditions,
        });
      }
    }
    return conditions;
  });

  return {
    $and: andConditions,
  };
}

function getIdRange(id: string, extK: number): Set<string> {
  const idRange = new Set<string>();
  const match = id.match(/_(\d+)$/);
  if (match) {
    const baseId = parseInt(match[1], 10);
    for (let i = Math.max(0, baseId - extK); i <= baseId + extK; i++) {
      if (i !== baseId) {
        idRange.add(`${id.substring(0, id.lastIndexOf('_') + 1)}${i}`);
      }
    }
  }
  return idRange;
}

const search = async (
  supabase: SupabaseClient,
  semantic_query: string,
  full_text_query: string[],
  topK: number,
  extK: number,
  meta_contains?: string,
  filter?: FilterType,
  datefilter?: DateFilterType,
) => {
  // console.log(full_text_query, topK, filter);

  let pgResponse = null;
  if (meta_contains) {
    pgResponse = await getStandardsMeta(supabase, meta_contains);
  }

  const searchVector = await openaiClient.embedQuery(semantic_query);

  // console.log(filter);

  const filters = [];

  if (pgResponse && pgResponse.length > 0) {
    const ids: string[] = [];
    pgResponse.forEach((item: { id: string }) => {
      ids.push(item.id);
    });
    filters.push({ terms: { rec_id: ids } });
  }
  if (pgResponse && pgResponse.length === 0) {
    return {
      message: 'No records found matching the metadata filters.',
      suggestion: 'Please try using different metadata filters.',
    };
  }

  if (filter || datefilter) {
    const filtersArray: Array<{ terms?: typeof filter; range?: typeof datefilter }> = [];
    if (filter) {
      filtersArray.push({ terms: filter });
    }
    if (datefilter) {
      filtersArray.push({ range: datefilter });
    }
    filters.push(...filtersArray);
  }
  // console.log(filters);

  const body = {
    query: filters
      ? {
          bool: {
            should: full_text_query.map((query) => ({
              match: { text: query },
            })),
            minimum_should_match: 1,
            filter: filters,
          },
        }
      : {
          bool: {
            should: full_text_query.map((query) => ({
              match: { text: query },
            })),
            minimum_should_match: 1,
          },
        },
    size: topK,
  };

  // console.log(body);
  // console.log(body.query.bool.filter);
  // console.log(filterToPCQuery(filter));
  interface QueryOptions {
    vector: number[];
    topK: number;
    includeMetadata: boolean;
    includeValues: boolean;
    filter?: PCFilter;
  }

  const queryOptions: QueryOptions = {
    vector: searchVector,
    topK: topK,
    includeMetadata: true,
    includeValues: false,
  };

  if (filters) {
    queryOptions.filter = filterToPCQuery(filters);
  }

  // console.log(queryOptions.filter);

  const [pineconeResponse, fulltextResponse] = await Promise.all([
    index.namespace(pinecone_namespace_esg).query(queryOptions),
    opensearchClient.search({
      index: opensearch_index_name,
      body: body,
    }),
  ]);

  // if (!pineconeResponse) {
  //   console.error("Pinecone query response is empty.");
  // }

  // console.log(pineconeResponse);
  // console.log(fulltextResponse.body.hits.hits);

  const id_set = new Set();
  let unique_docs = [];

  for (const doc of pineconeResponse.matches) {
    const id = doc.id;

    id_set.add(id);
    if (doc.metadata) {
      unique_docs.push({
        sort_id: parseInt(doc.id.match(/_(\d+)$/)?.[1] ?? '0', 10),
        id: doc.metadata.rec_id,
        page_number: doc.metadata.page_number,
        text: doc.metadata.text,
        report_title: doc.metadata.title,
        company_name: doc.metadata.company_name,
        publication_date: doc.metadata.publication_date,
      });
    }
  }
  // console.log(unique_docs);

  for (const doc of fulltextResponse.body.hits.hits) {
    const id = doc._id;

    if (!id_set.has(id)) {
      id_set.add(id);
      unique_docs.push({
        sort_id: parseInt(doc._id.match(/_(\d+)$/)?.[1] ?? '0', 10),
        id: doc._source.rec_id,
        page_number: doc._source.page_number,
        text: doc._source.text,
        report_title: doc._source.title,
        company_name: doc._source.company_name,
        publication_date: doc._source.publication_date,
      });
    }
  }

  if (extK > 0) {
    const extend_ids = new Set();
    for (const id of id_set) {
      const idRange = getIdRange(id as string, extK);
      for (const id of idRange) {
        extend_ids.add(id);
      }
    }

    for (const id of id_set) {
      extend_ids.delete(id);
    }

    const extFulltextResponse = await opensearchClient.mget({
      index: opensearch_index_name,
      body: {
        ids: [...extend_ids],
      },
    });

    const filteredResponse = extFulltextResponse.body.docs.filter(
      (doc: { found: boolean }) => doc.found,
    );
    // console.log(filteredResponse);

    for (const doc of filteredResponse) {
      // console.log(filteredResponse);
      unique_docs.push({
        sort_id: parseInt(doc._id.match(/_(\d+)$/)?.[1] ?? '0', 10),
        id: doc._source.rec_id,
        page_number: doc._source.page_number,
        text: doc._source.text,
        report_title: doc._source.title,
        company_name: doc._source.company_name,
        publication_date: doc._source.publication_date,
      });
    }
  }
  // console.log(unique_docs);

  // const unique_doc_id_set = new Set<string>();
  // for (const doc of unique_docs) {
  //   unique_doc_id_set.add(doc.id);
  // }

  // console.log(unique_doc_id_set);

  const docMap: {
    [key: string]: {
      sort_id: number;
      id: string;
      text: string;
      report_title: string;
      company_name: string;
      publication_date: number;
      page_number: number;
    };
  } = {};
  for (const doc of unique_docs) {
    if (!docMap[doc.id]) {
      docMap[doc.id] = { ...doc };
    } else {
      docMap[doc.id].text += '\n' + doc.text;
    }
  }
  unique_docs = Object.values(docMap).sort((a, b) => a.sort_id - b.sort_id);

  // console.log(unique_docs);

  const docList = unique_docs.map((doc) => {
    const report_title = doc.report_title;
    const company_name = doc.company_name;
    const publication_date = formatTimestampToDate(doc.publication_date);
    const page_number = doc.page_number;
    const source_entry = `${company_name}: **${report_title} (${page_number})**. ${publication_date}.`;
    return { content: doc.text, source: source_entry };
  });

  return docList;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // Get the session or user object
  const supabase = createClient(supabase_url, supabase_anon_key);
  const authResponse = await supabaseAuth(
    supabase,
    req.headers.get('email') ?? '',
    req.headers.get('password') ?? '',
  );
  if (authResponse.status !== 200) {
    return authResponse;
  }

  const { query, filter, datefilter, meta_contains, topK = 5, extK = 0 } = await req.json();
  // console.log(query, filter);

  logInsert(req.headers.get('email') ?? '', Date.now(), 'esg_search', topK);

  const res = await generateQuery(query);
  // console.log(res);
  // console.log([
  //   ...res.fulltext_query_chi_tra,
  //   ...res.fulltext_query_chi_sim,
  //   ...res.fulltext_query_eng,
  // ]);
  const result = await search(
    supabase,
    res.semantic_query,
    [...res.fulltext_query_chi_tra, ...res.fulltext_query_chi_sim, ...res.fulltext_query_eng],
    topK,
    extK,
    meta_contains,
    filter,
    datefilter,
  );
  // console.log(result);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/esg_search' \
    --header 'Content-Type: application/json' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query": "采取了哪些减排措施?", "filter": {"reportId": ["73338fdb-5c79-44fb-adbf-09f2b580acc8","07aba0bb-ac7c-41a2-b50b-d2f7793e5b3c"]}, "topK": 3}'

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/esg_search' \
    --header 'Content-Type: application/json' \
    --header 'email: xxx' \
    --header 'password: xxx' \
    --data '{"query": "哪些公司使用了阿里云来帮助减排", "topK": 3}'
*/
