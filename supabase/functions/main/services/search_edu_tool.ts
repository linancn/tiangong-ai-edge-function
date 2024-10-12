// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

type FilterType = { course: string[] } | Record<string | number | symbol, never>;

class SearchEduTool extends DynamicStructuredTool {
  constructor() {
    super({
      name: 'Search_Edu_Tool',
      description:
        'Call this tool to search the environmental science educational materials database for information.',
      schema: z.object({
        query: z.string().min(1).describe('Requirements or questions from the user.'),
        course: z.array(z.string()).default([]).describe('course name to filter the search.'),
        topK: z.number().default(5).describe('Number of results to return.'),
      }),
      func: async ({ query, course, topK }: { query: string; course: string[]; topK: number }) => {
        const filter: FilterType = course.length > 0 ? { course: course } : {};
        const isFilterEmpty = Object.keys(filter).length === 0;
        const requestBody = JSON.stringify(
          isFilterEmpty ? { query, topK } : { query, topK, filter },
        );

        const url = 'https://qyyqlnwqwgvzxnccnbgm.supabase.co/functions/v1/edu_search';

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${
                Deno.env.get('LOCAL_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
              }`,
              email: Deno.env.get('EMAIL') ?? '',
              password: Deno.env.get('PASSWORD') ?? '',
              'x-region': 'us-east-1',
            },
            body: requestBody,
          });

          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          return JSON.stringify(data);
        } catch (error) {
          console.error('Error making the request:', error);
          throw error;
        }
      },
    });
  }
}

export default SearchEduTool;
