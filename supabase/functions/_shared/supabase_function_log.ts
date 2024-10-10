// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";

import { Client } from "@opensearch-project/opensearch";

function logInsert(
    email: string,
    invoked_at: number,
    service_type: string,
    top_k: number = 0,
  ) {

    const opensearch_node = Deno.env.get("OPENSEARCH_NODE") ?? "";
    const opensearchClient = new Client({
      node: opensearch_node,
    });

    const document = {
      email,
      invoked_at,
      service_type,
      top_k,
    };
  
    opensearchClient.index({
      index: "function_log",
      body: document,
    }).then(() => {
    }).catch((error) => {
      console.error("Error inserting log:", error);
    });
  }

export default logInsert;
