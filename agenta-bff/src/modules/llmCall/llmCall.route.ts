import { FastifyInstance } from "fastify";
import { getLLMCallsHandler } from "./llmCall.controller";
import { $ref } from "./llmCall.schema";

async function llmCallsRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      schema: {
        response: {},
      },
    },

    getLLMCallsHandler
  );
}

export default llmCallsRoutes;
