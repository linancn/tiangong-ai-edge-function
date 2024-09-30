// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

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
        query: z.string().min(1).describe(
          "Requirements or questions from the user.",
        ),
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
          email: string;
          password: string;
        },
      ) => {
        const filter: FilterType = journal.length > 0
          ? { journal: journal }
          : {};
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

export default SearchSciTool;
