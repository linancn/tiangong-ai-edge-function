// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="https://esm.sh/v135/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

// import "npm:/duck-duck-scrape";

// import { DuckDuckGoSearch } from "npm:/@langchain/community/tools/duckduckgo_search";
import {
  AIMessage,
  BaseMessage,
  FunctionMessage,
  HumanMessage,
} from "https://esm.sh/@langchain/core/messages";
import { END, MessageGraph, START } from "npm:/@langchain/langgraph";

import { ChatOpenAI } from "https://esm.sh/@langchain/openai";
import { ChatPromptTemplate } from "https://esm.sh/@langchain/core/prompts";
import SearchEsgTool from "../_shared/search_esg_tool.ts";
import { StringOutputParser } from "https://esm.sh/@langchain/core/output_parsers";
import { ToolExecutor } from "https://esm.sh/@langchain/langgraph/prebuilt";
import { convertToOpenAIFunction } from "https://esm.sh/@langchain/core/utils/function_calling";
import { pull } from "https://esm.sh/langchain/hub";
import { z } from "https://esm.sh/zod";
import { zodToJsonSchema } from "https://esm.sh/zod-to-json-schema";

// import { ToolNode } from "npm:/@langchain/langgraph/prebuilt";
// import { DuckDuckGoSearch } from "npm:/@langchain/community/tools/duckduckgo_search";

Deno.serve(async (req) => {
  const { query } = await req.json();

  const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
  const openai_chat_model = Deno.env.get("OPENAI_CHAT_MODEL") ?? "";

  // const tools = [new DuckDuckGoSearch({ maxResults: 3 })];
  const tools = [new SearchEsgTool()];

  const toolExecutor = new ToolExecutor({
    tools,
  });
  // const toolNode = new ToolNode<BaseMessage[]>(tools);


  async function retrieve(state: Array<BaseMessage>) {
    console.log("---EXECUTE RETRIEVAL---");
    // Based on the continue condition
    // we know the last message involves a function call.
    const lastMessage = state[state.length - 1];
    const action = {
      tool: lastMessage.additional_kwargs.function_call?.name ?? "",
      toolInput: JSON.parse(
        lastMessage.additional_kwargs.function_call?.arguments ?? "{}",
      ),
    };
    // We call the tool_executor and get back a response.
    const response = await toolExecutor.invoke(action);
    // We use the response to create a FunctionMessage.
    const functionMessage = new FunctionMessage({
      name: action.tool,
      content: response,
    });
    console.log("Response:", response, "---END RETRIEVE---");
    return [functionMessage];
  }

  async function gradeDocuments(state: Array<BaseMessage>) {
    console.log("---GET RELEVANCE---");
    // Output
    const output = zodToJsonSchema(z.object({
      binaryScore: z.string().describe("Relevance score 'yes' or 'no'"),
    }));
    const tool = {
      type: "function" as const,
      function: {
        name: "give_relevance_score",
        description: "Give a relevance score to the retrieved documents.",
        parameters: output,
      },
    };

    const prompt = ChatPromptTemplate.fromTemplate(
      `You are a grader assessing relevance of retrieved info to a user question.
    Here are the retrieved docs:
    \n ------- \n
    {context} 
    \n ------- \n
    Here is the user question: {question}
    If the content of the docs are relevant to the users question, score them as relevant.
    Give a binary score 'yes' or 'no' score to indicate whether the docs are relevant to the question.
    Yes: The docs are relevant to the question.
    No: The docs are not relevant to the question.`,
    );

    const model = new ChatOpenAI({
      apiKey: openai_api_key,
      modelName: openai_chat_model,
      temperature: 0,
    }).bind({
      tools: [tool],
      tool_choice: tool,
    });
  
    const chain = prompt.pipe(model);
  
    const lastMessage = state[state.length - 1];
  
    const score = await chain.invoke({
      question: state[0].content as string,
      context: lastMessage.content as string,
    });
    console.log("Score:", score, "---END GRADE DOCUMENTS---");
    return [score];
  }

  function checkRelevance(state: Array<BaseMessage>) {
    console.log("---CHECK RELEVANCE---");
    const lastMessage = state[state.length - 1];
    const toolCalls = lastMessage.additional_kwargs.tool_calls;
    if (!toolCalls) {
      throw new Error("Last message was not a function message");
    }
    const parsedArgs = JSON.parse(toolCalls[0].function.arguments);
  
    if (parsedArgs.binaryScore === "yes") {
      console.log("---DECISION: DOCS RELEVANT---");
      return "yes";
    }
    console.log("---DECISION: DOCS NOT RELEVANT---");
    return "no";
  }

  async function agent(state: Array<BaseMessage>) {
    console.log("---CALL AGENT---");
    const functions = tools.map((tool) => convertToOpenAIFunction(tool));
    const model = new ChatOpenAI({
      apiKey: openai_api_key,
      modelName: openai_chat_model,
      temperature: 0,
      streaming: true,
    }).bind({
      functions,
    });
  
    const response = await model.invoke(state);
    console.log("---INVOKE TOOL---");
    // We can return just the response because it will be appended to the state.
    return [response];
  }


  async function rewrite(state: Array<BaseMessage>) {
    console.log("---REWRITE QUERY---");
    const question = state[0].content as string;
    const prompt = ChatPromptTemplate.fromTemplate(
      `Look at the input and try to reason about the underlying semantic intent / meaning. \n 
    Here is the initial question:
    \n ------- \n
    {question} 
    \n ------- \n
    Formulate an improved question:`,
    );
  
    // Grader
    const model = new ChatOpenAI({
      apiKey: openai_api_key,
      modelName: openai_chat_model,
      temperature: 0,
      streaming: true,
    });
    const response = await prompt.pipe(model).invoke({ question });
    console.log("---END REWRITE---");
    return [response];
  }

  async function generate(state: Array<BaseMessage>) {
    console.log("---GENERATE---");
    const question = state[0].content as string;
    const sendLastMessage = state[state.length - 2];
  
    const docs = sendLastMessage.content as string;
  
    const prompt = await pull<ChatPromptTemplate>("rlm/rag-prompt");
  
    const llm = new ChatOpenAI({
      apiKey: openai_api_key,
      modelName: openai_chat_model,
      temperature: 0,
      streaming: true,
    });
  
    const ragChain = prompt.pipe(llm).pipe(new StringOutputParser());
  
    const response = await ragChain.invoke({
      context: docs,
      question,
    });
    console.log("---GENERATE COMPLETED---");
    return [new AIMessage(response)];
  }


  // const model = new ChatOpenAI({
  //   apiKey: openai_api_key,
  //   model: openai_chat_model,
  // }).bindTools(tools);

  const graph = new MessageGraph()
    .addNode("agent", agent)
    .addNode("retrieve", retrieve)
    .addNode("gradeDocuments", gradeDocuments)
    .addNode("rewrite", rewrite)
    .addNode("generate", generate);


  graph.addEdge(START,"agent");
  graph.addEdge("agent", "retrieve");
  graph.addEdge("retrieve", "gradeDocuments");
  graph.addConditionalEdges("gradeDocuments", checkRelevance,
    {
      // Call tool node
      yes: "generate",
      no: "rewrite", // placeholder
    },
  );
  graph.addEdge("rewrite", "agent");
  graph.addEdge("generate", END);



  const runnable = graph.compile();
  console.log("---GRAPH COMPILED---");
  const inputs = [new HumanMessage(query)];
  // const response = await runnable.invoke(inputs);
  let finalState;
  for await (const output of await runnable.stream(inputs)) {
    for (const [key, value] of Object.entries(output)) {
      console.log(`Output from node: '${key}'`);
      finalState = value;
  }
  console.log("\n---\n");
}

  console.log("---GRAPH COMPLETED---");

  return new Response(
    JSON.stringify(finalState, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/esg_compliance' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"query":"哪些公司使用了阿里云来帮助减排？"}'

*/
