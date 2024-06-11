import SearchApi from "npm:duckduckgo-search@1.0.5";
import {  DynamicStructuredTool } from "https://esm.sh/@langchain/core@0.2.5/tools";
import { z } from "https://esm.sh/zod@3.23.8";

class SearchInternetTool {

    async search(query: string, maxResults: number) {
        const res = [];
        let count = 0;
        for await (const result of SearchApi.text(query)) {
            res.push(result)
            count++;
            if (count >= maxResults) {
                break;
            }
        }
        return res;
    }

    invoke() {
        return new DynamicStructuredTool({
            name: "Search_Internet_Tool",
            description: "Call this tool to search the internet for information.",
            schema: z.object({
                query: z.string(),
                maxResults: z.number().default(3),
            }),
            func: async ({ query, maxResults }) => {
                if (!query) {
                    throw new Error("Query is required");
                }
                const results = await this.search(query, maxResults);
                return JSON.stringify(results); 
            }
        });
    }
}

export default SearchInternetTool