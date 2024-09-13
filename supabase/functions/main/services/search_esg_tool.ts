/// <reference types="https://esm.sh/v135/@supabase/functions-js/src/edge-runtime.d.ts" />

import { DynamicStructuredTool } from "https://esm.sh/@langchain/core/tools";
import { z } from "https://esm.sh/zod";

type FilterType =
  | { rec_id: { "$in": string[] } }
  | Record<string | number | symbol, never>;

class SearchEsgTool extends DynamicStructuredTool {
  constructor() {
    super({
      name: "Search_ESG_Tool",
      description: "Call this tool to search the ESG database for information.",
      schema: z.object({
        query: z.string().min(1).describe(
          "Requirements or questions from the user.",
        ),
        docIds: z.array(z.string()).default([]).describe(
          "document ids to filter the search.",
        ),
        topK: z.number().default(5).describe("Number of results to return."),
      }),
      func: async (
        { query, docIds, topK }: {
          query: string;
          docIds: string[];
          topK: number;
        },
      ) => {
        const filter: FilterType = docIds.length > 0
          ? { rec_id: { "$in": docIds } }
          : {};
        const isFilterEmpty = Object.keys(filter).length === 0;
        const requestBody = JSON.stringify(
          isFilterEmpty ? { query, topK } : { query, topK, filter },
        );

        const url =
          "https://qyyqlnwqwgvzxnccnbgm.supabase.co/functions/v1/esg_search";
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${
                Deno.env.get("LOCAL_SUPABASE_ANON_KEY") ??
                  Deno.env.get("SUPABASE_ANON_KEY") ?? ""
              }`,
              "email": Deno.env.get("EMAIL") ?? "",
              "password": Deno.env.get("PASSWORD") ?? "",
              "x-region": "us-east-1",
            },
            body: requestBody,
          });
          if (!response.ok) {
            throw new Error(
              `HTTP error: ${response.status} ${response.statusText}`,
            );
          }
          const data = await response.json();
          return JSON.stringify(data);
        } catch (error) {
          console.error("Error making the request:", error);
          throw error;
        }
      },
    });
  }
}

export default SearchEsgTool;
