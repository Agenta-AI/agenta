import Fastify from "fastify";
import llmCallsRoutes from "./modules/llmCall/llmCall.route";
import { llmCallSchemas } from "./modules/llmCall/llmCall.schema";
import cors from '@fastify/cors'

function buildServer() {
  const server = Fastify();

  const urls = ["localhost", "127.0.0.1", "http://localhost:3000"]
  server.register(cors, {
    origin: urls,
    // methods: ['GET', 'POST'],
    // credentials: true
  })

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
