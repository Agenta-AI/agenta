import Fastify from "fastify";
import llmCallsRoutes from "./modules/llmCall/llmCall.route";
import { llmCallSchemas } from "./modules/llmCall/llmCall.schema";

function buildServer() {
  const server = Fastify();

  server.get("/healthcheck", async function () {
    return { status: "OK" };
  });

  for (const schema of [...llmCallSchemas]) {
    server.addSchema(schema);
  }

  server.register(llmCallsRoutes, { prefix: "api/llm-calls" });
  // server.register(productRoutes, { prefix: "api/products" });
  return server;
}

export default buildServer;
