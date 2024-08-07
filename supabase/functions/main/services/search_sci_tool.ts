/// <reference types="https://esm.sh/v135/@supabase/functions-js/src/edge-runtime.d.ts" />

import { DynamicStructuredTool } from "https://esm.sh/@langchain/core/tools";
import { z } from "https://esm.sh/zod";

type FilterType =
  | { journal: string[] }
  | Record<string | number | symbol, never>;

class SearchSciTool extends DynamicStructuredTool {
  constructor() {
    super({
      name: "Search_Sci_Tool",
      description:
        "Call this tool to search the environmental vector database for specialized information.",
      schema: z.object({
        query: z.string().describe("Requirements or questions from the user."),
        journal: z.array(z.string()).default([]).describe(
          "journal name to filter the search.",
        ),
        topK: z.number().default(5).describe("Number of results to return."),
      }),
      func: async (
        { query, journal, topK }: {
          query: string;
          journal: string[];
          topK: number;
        },
      ) => {
        if (!query) {
          throw new Error("Query is empty.");
        }

        const filter: FilterType = journal.length > 0 ? { journal: journal } : {};
        const isFilterEmpty = Object.keys(filter).length === 0;
        const requestBody = JSON.stringify(
          isFilterEmpty ? { query, topK } : { query, topK, filter },
        );

        const url =
          "https://qyyqlnwqwgvzxnccnbgm.supabase.co/functions/v1/sci_search";

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SP_ANON_KEY")}`,
              "x-password": Deno.env.get("X_PASSWORD") ?? "",
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

export default SearchSciTool;
