import { Pinecone } from "https://esm.sh/@pinecone-database/pinecone@2.2.2";

import { OpenAIEmbeddings } from "https://esm.sh/@langchain/openai@0.1.1";
import { BaseClient } from "https://esm.sh/@xata.io/client@0.28.4";

import { DynamicStructuredTool } from "https://esm.sh/@langchain/core@0.2.5/tools";
import { z } from "https://esm.sh/zod@3.23.8";

const pinecone_api_key = Deno.env.get("PINECONE_API_KEY") ?? "";
const pinecone_index_name = Deno.env.get("PINECONE_INDEX_NAME") ?? "";
const pinecone_namespace_esg = Deno.env.get("PINECONE_NAMESPACE_ESG") ?? "";

const xata_api_key = Deno.env.get("XATA_API_KEY") ?? "";
const xata_esg_db_url = Deno.env.get("XATA_ESG_DB_URL") ?? "";
const xata_branch = Deno.env.get("XATA_BRANCH") ?? "";

const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
const openai_embedding_model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "";

interface RecordType {
    company_short_name: string;
    publication_date: object;
    id: string;
    report_title: string;
    xata: object;
}


class SearchEsgTool {
    openaiClient: OpenAIEmbeddings;

    constructor(){
        this.openaiClient = new OpenAIEmbeddings({
            apiKey: openai_api_key,
            model: openai_embedding_model,
        });
    }

    async search(query: string, topK: number, filter: object) {
        const pc = new Pinecone({ apiKey: pinecone_api_key});
        const index = pc.index(pinecone_index_name);
        const xata = new BaseClient({
            databaseURL: xata_esg_db_url,
            apiKey: xata_api_key,
            branch: xata_branch,
        });
        const searchVector = await this.openaiClient.embedQuery(query);
        const queryResponse = await index.namespace(pinecone_namespace_esg).query({
            vector: searchVector,
            filter: filter,
            topK: topK,
            includeMetadata: true,
        })
        if (!queryResponse) {
            console.error("doc id does not exist");
        }

        const id_set = new Set();
        for (const doc of queryResponse.matches) {
            id_set.add(doc?.metadata?.rec_id);
        }
        const xataResponse = await xata.db["ESG"].select(["company_short_name", "report_title", "publication_date"]).filter({id: {"$any": [...id_set]}}).getMany();


        const recordsDict: {[id: string]: RecordType} = {};

        for (const record of xataResponse) {
            const id = record.id;
            recordsDict[id] = record;
        }

        const docList = [];
        for (const doc of queryResponse.matches) {
                const metadata = (doc as {metadata: object}).metadata;
                const id = (metadata as {rec_id: string}).rec_id.toString();
                const record = recordsDict[id];

                if (record) {
                    const formattedDate = new Date(record.publication_date.toString()).toISOString().split('T')[0];
                    const companyShortName = record.company_short_name;
                    const reportTitle = record.report_title;
                    const pageNumber = doc?.metadata?.page_number;
                    const sourceEntry = `${companyShortName}. ${reportTitle}. ${formattedDate}. (P${pageNumber})`;
                    docList.push({content: doc?.metadata?.text, source: sourceEntry});
                } else {
                    throw new Error("Record not found");
                }
            }
            return docList;
    }

    invoke() {
        return new DynamicStructuredTool({
            name: "Search_ESG_Tool",
            description: "Call this tool to search the ESG database for information.",
            schema: z.object({
                query: z.string().describe("Requirements or questions from the user."),
                docIds: z.array(z.string()).default([]).describe("document ids to filter the search."),
                topK: z.number().default(3).describe("Number of results to return."),
            }),
            func: async ({ query, docIds, topK }) => {
                if (!query) {
                    throw new Error("Query is required");
                }
                if (docIds.length > 0) {
                    const filter = { rec_id: {"$in": docIds} };
                    const results = await this.search(query, topK, filter);
                    return JSON.stringify(results); 
                } else {
                    const filter = {};
                    const results = await this.search(query, topK, filter);
                    return JSON.stringify(results); 
                }
            }
        });
    }
}

export default SearchEsgTool