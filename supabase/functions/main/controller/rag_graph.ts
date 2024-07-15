/// <reference types="https://esm.sh/v135/@supabase/functions-js/src/edge-runtime.d.ts" />

import {
  AIMessage,
  BaseMessage,
  FunctionMessage,
  HumanMessage,
} from "https://esm.sh/@langchain/core/messages";
import { END, MessageGraph, START } from "npm:/@langchain/langgraph";

import { ChatOpenAI } from "https://esm.sh/@langchain/openai";
import { ChatPromptTemplate } from "https://esm.sh/v135/@langchain/core@0.2.11/prompts.js";
import { Context } from "jsr:@hono/hono";
import SearchEsgTool from "../services/search_esg_tool.ts";
import { StringOutputParser } from "https://esm.sh/@langchain/core/output_parsers";
import { ToolExecutor } from "npm:/@langchain/langgraph/prebuilt";
import { convertToOpenAIFunction } from "https://esm.sh/@langchain/core/utils/function_calling";

async function ragProcess(c: Context) {
  const req = c.req;
  const { query } = await req.json();
  const openai_api_key = Deno.env.get("OPENAI_API_KEY") ?? "";
  const openai_chat_model = Deno.env.get("OPENAI_CHAT_MODEL") ?? "";

  const tools = [new SearchEsgTool()];

  const toolExecutor = new ToolExecutor({
    tools,
  });


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
    const response = await toolExecutor._execute(action);
    // We use the response to create a FunctionMessage.
    const functionMessage = new FunctionMessage({
      name: action.tool,
      content: response,
    });
    console.log("Response:", response, "---END RETRIEVE---");
    return [functionMessage];
  }

  async function generate(state: Array<BaseMessage>) {
    console.log("---GENERATE---");
    console.log(state);
    const question = state[0].content as string;
    const sendLastMessage = state[state.length - 1];

    const docs = sendLastMessage.content;

    const prompt = ChatPromptTemplate.fromTemplate(
      `You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question. If you cannot answer the question from the context, just say that the report does not provide enough evidence. Must provide based on which contexts you generate your answer and their source.
      Question: {question} 
      Context: {context} 
      Answer:`
    );

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

  const graph = new MessageGraph()
  .addNode("agent", agent)
  .addNode("retrieve", retrieve)
  .addNode("generate", generate);

  graph.addEdge(START, "agent");
  graph.addEdge("agent", "retrieve");
  graph.addEdge("retrieve", "generate");
  graph.addEdge("generate", END);

  const runnable = graph.compile();
  const inputs = [new HumanMessage(query)];

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
}

export default ragProcess;