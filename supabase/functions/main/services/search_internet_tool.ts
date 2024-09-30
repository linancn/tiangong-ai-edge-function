// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

class SearchInternetTool extends DynamicStructuredTool {
  constructor() {
    super({
      name: "Search_Internet_Tool",
      description:
        "Call this tool to search internet for up-to-date information.",
      schema: z.object({
        query: z.string().min(1).describe(
          "Requirements or questions from the user.",
        ),
        maxResults: z.number().default(5).describe(
          "Number of results to return.",
        ),
      }),
      func: async (
        { query, maxResults }: {
          query: string;
          maxResults: number;
          email: string;
          password: string;
        },
      ) => {
        const requestBody = JSON.stringify(
          { query, maxResults },
        );

        const url =
          "https://qyyqlnwqwgvzxnccnbgm.supabase.co/functions/v1/internet_search";

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

export default SearchInternetTool;
