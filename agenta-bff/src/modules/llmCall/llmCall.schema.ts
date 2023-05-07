import { z } from "zod";
import { buildJsonSchemas } from "fastify-zod";

const llmCallGenerated = {
  _id: z.number(),
  // prompt: z.object(),
  // output: z.string(),
  // parameters: z.object()
};

const llmCallResponseSchema = z.object({

});

const llmCallsResponseSchema = z.array(llmCallResponseSchema);

export const { schemas: llmCallSchemas, $ref } = buildJsonSchemas({
  llmCallResponseSchema,
  llmCallsResponseSchema,
});
