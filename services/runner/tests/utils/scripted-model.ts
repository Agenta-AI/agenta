/**
 * A scripted OpenAI-compatible model server (streaming chat completions) for tests that run the
 * real Pi agent loop. Each model request takes the next step of the script: text, one tool call,
 * or silence that never answers (to trip a watchdog). The last step repeats once the script is
 * used up. A request to `/v1/messages` gets its text step in the Anthropic Messages format.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type ScriptStep =
  | { text: string }
  /** `signature` streams a Gemini `thought_signature` on the call, as Google's OpenAI-compatible endpoints do. */
  | { tool: string; args: Record<string, unknown>; signature?: string }
  /** Answer with an HTTP error, as a router does for an upstream provider's refusal. */
  | { error: { status: number; message: string } }
  /** Accept the request and never answer. */
  | { silence: true }
  /** Stream thinking deltas every `everyMs` for `forMs`, then the text: a slow reasoning model. */
  | { think: { everyMs: number; forMs: number }; text: string };

export interface ScriptedModel {
  baseUrl: string;
  requests: Array<{ messages: unknown[]; headers: import("node:http").IncomingHttpHeaders }>;
  /** Replace the rest of the script. */
  script(steps: ScriptStep[]): void;
  close(): Promise<void>;
}

export async function startScriptedModel(initial: ScriptStep[] = [{ text: "ok" }]): Promise<ScriptedModel> {
  let steps = [...initial];
  const requests: ScriptedModel["requests"] = [];
  let calls = 0;
  const open = new Set<import("node:http").ServerResponse>();
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const parsed = JSON.parse(body || "{}") as { messages?: unknown[] };
      requests.push({ messages: parsed.messages ?? [], headers: req.headers });
      const step = steps.length > 1 ? steps.shift()! : steps[0]!;
      if ("error" in step) {
        res.writeHead(step.error.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: step.error.message, code: step.error.status } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      open.add(res);
      res.on("close", () => open.delete(res));
      if ("silence" in step) return;
      calls += 1;
      if (new URL(req.url ?? "/", "http://mock").pathname.endsWith("/messages")) {
        if (!("text" in step) || "think" in step) throw new Error("the Anthropic Messages format answers text steps only");
        const event = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        const usage = { input_tokens: 10, output_tokens: 5 };
        event("message_start", { message: { id: `msg_${calls}`, type: "message", role: "assistant", model: "mock-1", content: [], stop_reason: null, usage } });
        event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        event("content_block_delta", { index: 0, delta: { type: "text_delta", text: step.text } });
        event("content_block_stop", { index: 0 });
        event("message_delta", { delta: { stop_reason: "end_turn" }, usage });
        event("message_stop", {});
        res.end();
        return;
      }
      const base = { id: `chatcmpl-${calls}`, object: "chat.completion.chunk", created: 0, model: "mock-1" };
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if ("think" in step) {
        const until = Date.now() + step.think.forMs;
        while (Date.now() < until) {
          send({ ...base, choices: [{ index: 0, delta: { reasoning_content: "." }, finish_reason: null }] });
          await new Promise((r) => setTimeout(r, step.think.everyMs));
        }
      }
      if ("tool" in step) {
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${calls}`,
                    type: "function",
                    function: { name: step.tool, arguments: JSON.stringify(step.args) },
                    ...(step.signature ? { extra_content: { google: { thought_signature: step.signature } } } : {}),
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: step.text }, finish_reason: null }] });
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      send({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    script: (next) => {
      steps = [...next];
    },
    close: async () => {
      for (const res of open) res.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
