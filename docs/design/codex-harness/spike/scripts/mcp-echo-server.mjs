#!/usr/bin/env node
// Trivial stdio MCP server exposing one tool: spike_echo.
// Logs every request it sees to the file given in SPIKE_MCP_LOG (so we can prove codex called it).
import { appendFileSync } from "node:fs";

const LOG = process.env.SPIKE_MCP_LOG;
const log = (obj) => {
  if (LOG) {
    try {
      appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...obj }) + "\n");
    } catch {}
  }
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

function handle(msg) {
  log({ dir: "in", msg });
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "spike-echo", version: "0.0.1" },
      },
    });
  } else if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "spike_echo",
            description:
              "Echoes back the given text. Use this when asked to call the spike echo tool.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      },
    });
  } else if (method === "tools/call") {
    const text = params?.arguments?.text ?? "";
    send({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: `SPIKE_ECHO_RESULT:${text}` }],
      },
    });
  } else if (id !== undefined) {
    // Any other request: succeed with an empty result to keep the client happy.
    send({ jsonrpc: "2.0", id, result: {} });
  }
  // Notifications (no id) are ignored.
}
