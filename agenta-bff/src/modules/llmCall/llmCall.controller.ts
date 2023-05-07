import { FastifyReply, FastifyRequest } from "fastify";
import { getLLMCalls } from "./llmCall.service";


export async function getLLMCallsHandler() {
  const llmCalls = await getLLMCalls();

  return llmCalls;
}
