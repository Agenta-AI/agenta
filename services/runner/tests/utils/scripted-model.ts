/**
 * A scripted OpenAI-compatible model server (streaming chat completions) for tests that run the
 * real Pi agent loop. Each model request takes the next step of the script: text, one tool call,
 * or silence that never answers (to trip a watchdog). The last step repeats once the script is
 * used up.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type ScriptStep =
  | { text: string }
  | { tool: string; args: Record<string, unknown> }
  /** Answer with an HTTP error, as a router does for an upstream provider's refusal. */
  | { error: { status: number; message: string } }
  /** Accept the request and never answer. */
  | { silence: true }
  /** Stream thinking deltas every `everyMs` for `forMs`, then the text: a slow reasoning model. */
  | { think: { everyMs: number; forMs: number }; text: string };

export interface ScriptedModel {
  baseUrl: string;
  requests: Array<{ messages: unknown[] }>;
  /** Replace the rest of the script. */
  script(steps: ScriptStep[]): void;
  close(): Promise<void>;
}

export async function startScriptedModel(initial: ScriptStep[] = [{ text: "ok" }]): Promise<ScriptedModel> {
  let steps = [...initial];
  const requests: Array<{ messages: unknown[] }> = [];
  let calls = 0;
  const open = new Set<import("node:http").ServerResponse>();
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const parsed = JSON.parse(body || "{}") as { messages?: unknown[] };
      requests.push({ messages: parsed.messages ?? [] });
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
              delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${calls}`, type: "function", function: { name: step.tool, arguments: JSON.stringify(step.args) } }] },
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
