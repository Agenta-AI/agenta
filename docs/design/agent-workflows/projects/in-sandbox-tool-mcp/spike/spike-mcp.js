#!/usr/bin/env node
/**
 * Minimal stdio MCP server for the in-sandbox platform-tool spike.
 *
 * Speaks newline-delimited JSON-RPC on stdin/stdout (the MCP stdio transport).
 * Exposes ONE tool, `spike_echo`. On every spawn it appends a `spawned pid=...`
 * line to LOG_PATH, and it logs each JSON-RPC method it receives, so the spike
 * driver can prove (from outside the process) whether the Claude ACP adapter
 * respawned it after a Daytona stop/start cycle.
 *
 * stdout carries ONLY JSON-RPC. All diagnostics go to the log file and stderr.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const LOG_PATH = process.env.SPIKE_MCP_LOG || "/home/sandbox/agenta/spike-mcp.log";

function logLine(text) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${text}\n`);
  } catch (err) {
    process.stderr.write(`spike-mcp log write failed: ${err && err.message}\n`);
  }
}

logLine(`spawned pid=${process.pid} at=${new Date().toISOString()}`);

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
  );
}

const TOOLS = [
  {
    name: "spike_echo",
    description:
      "Echo the given text back, tagged with the MCP server's process id. " +
      "Use whenever asked to call spike_echo.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo back." } },
      required: ["text"],
    },
  },
];

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    logLine(`pid=${process.pid} unparseable line (${trimmed.length} bytes)`);
    return;
  }
  const { id, method, params } = message;
  logLine(`pid=${process.pid} method=${method ?? "(response)"} at=${new Date().toISOString()}`);
  if (method === undefined) return; // a response to something we sent (we send nothing)

  if (method === "initialize") {
    reply(id, {
      protocolVersion: (params && params.protocolVersion) || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "agenta-spike-mcp", version: "0.0.1" },
    });
    return;
  }
  if (method === "notifications/initialized" || method.startsWith("notifications/")) {
    return; // notifications get no response
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const toolName = params && params.name;
    if (toolName !== "spike_echo") {
      replyError(id, -32602, `unknown tool: ${toolName}`);
      return;
    }
    const text = (params.arguments && params.arguments.text) || "";
    logLine(`pid=${process.pid} tools/call spike_echo text=${JSON.stringify(text)}`);
    reply(id, {
      content: [{ type: "text", text: `spike_echo pid=${process.pid} echoed: ${text}` }],
      isError: false,
    });
    return;
  }
  if (id !== undefined) replyError(id, -32601, `method not implemented: ${method}`);
});

rl.on("close", () => {
  logLine(`pid=${process.pid} stdin closed at=${new Date().toISOString()}`);
  process.exit(0);
});
