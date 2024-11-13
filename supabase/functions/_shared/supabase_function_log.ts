// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

function logInsert(email: string, invoked_at: number, service_type: string, top_k: number = 0) {
  const opensearch_region = Deno.env.get('OPENSEARCH_REGION') ?? '';
  const opensearch_domain = Deno.env.get('OPENSEARCH_DOMAIN') ?? '';

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

  const document = {
    email,
    invoked_at,
    service_type,
    top_k,
  };

  opensearchClient
    .index({
      index: 'function_log',
      body: document,
    })
    .then(() => {})
    .catch((error) => {
      console.error('Error inserting log:', error);
    });
}

export default logInsert;
