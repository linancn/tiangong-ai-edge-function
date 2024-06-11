// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="https://esm.sh/v135/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

import { ChatOpenAI } from "npm:/@langchain/openai";
import { END, MessageGraph, START } from "npm:/@langchain/langgraph@0.0.22";
import { ToolNode } from "npm:/@langchain/langgraph@0.0.22/prebuilt";
// import { DuckDuckGoSearch } from "npm:/@langchain/community@0.2.9/tools/duckduckgo_search";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
} from "npm:/@langchain/core@0.2.5/messages";
import "npm:/duck-duck-scrape@2.2.5";
import SearchEsgTool from "../_shared/search_esg_tool.ts";

Deno.serve(async (req) => {
  const { query } = await req.json();

  const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
  const openai_chat_model = Deno.env.get("OPENAI_CHAT_MODEL") ?? "";

  // const tools = [new DuckDuckGoSearch({ maxResults: 1 }), new SearchEsgTool()];
  const tools = [new SearchEsgTool()];
  const toolNode = new ToolNode<BaseMessage[]>(tools);

  const model = new ChatOpenAI({
    apiKey: openai_api_key,
    model: openai_chat_model,
  }).bindTools(tools);

  const graph = new MessageGraph()
    .addNode("model", async (state: BaseMessage[]) => {
      const response = await model.invoke(state);
      return [response];
    })
    .addNode("retriever", toolNode)
    .addEdge(START, "model")
    .addEdge("retriever", END);

  const router = (state: BaseMessage[]) => {
    const toolCalls = (state[state.length - 1] as AIMessage).tool_calls ?? [];
    if (toolCalls.length) {
      return "retriever";
    } else {
      return "end";
    }
  };

  graph.addConditionalEdges("model", router, {
    retriever: "retriever",
    end: END,
  });

  const runnable = graph.compile();
  const response = await runnable.invoke(new HumanMessage(query));

  return new Response(
    JSON.stringify(response),
    { headers: { "Content-Type": "application/json" } },
  );
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/esg_compliance' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"query":"阿里有哪些减排措施？"}'

*/
