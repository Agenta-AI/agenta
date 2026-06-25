/**
 * Agent runner HTTP server: the HTTP transport for the Harness port.
 *
 * Same contract as the CLI, exposed over HTTP so the wrapper can run as its own
 * container (a sidecar) that the Python service calls in-network:
 *
 *   GET  /health -> runner identity ({ status, runner, protocol, engines, harnesses })
 *   POST /run    -> body is an AgentRunRequest, response is an AgentRunResult
 *
 * Uses Node's built-in http server (no framework dependency).
 *
 * `createAgentServer(run)` is the testable seam: it builds the server around an injectable
 * engine runner so the HTTP behavior can be tested with a fake engine (no live harness).
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type {
  AgentRunRequest,
  AgentRunResult,
  EmitEvent,
  StreamRecord,
} from "./protocol.ts";
import { runSandboxAgent } from "./engines/sandbox_agent.ts";
import { runnerInfo } from "./version.ts";
import { isEntrypoint } from "./entry.ts";

const PORT = Number(process.env.PORT ?? 8765);

/** Run one request through an engine. Tests inject a fake to avoid a live harness. */
export type RunAgent = (
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
) => Promise<AgentRunResult>;

// One engine: `sandbox-agent` drives a harness (Pi or Claude) over ACP. The harness is
// selected by `request.harness`, not by an engine selector.
const runAgent: RunAgent = (request, emit, signal) =>
  runSandboxAgent(request, emit, signal);

/**
 * Stream a run as NDJSON: one `{kind:"event"}` line per event the moment it is built, then
 * exactly one terminal `{kind:"result"}` line (success or failure). Selected by the caller
 * with `Accept: application/x-ndjson`; the one-shot `/run` path is left untouched.
 */
async function runAndStream(
  _req: IncomingMessage,
  res: ServerResponse,
  request: AgentRunRequest,
  run: RunAgent,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });

  // A client disconnect aborts the in-flight run rather than letting it finish unobserved.
  // Listen on the response, not the request: the request body is already fully read, so its
  // `close` can fire early on a keep-alive connection. `res` `close` fires when the response
  // connection ends — after a normal `res.end()` (harmless: the run is already done) or when
  // the client drops mid-stream (the case we want to cancel).
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const writeRecord = (record: StreamRecord): void => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(record) + "\n");
  };
  const emit: EmitEvent = (event) => writeRecord({ kind: "event", event });

  let result: AgentRunResult;
  try {
    result = await run(request, emit, controller.signal);
  } catch (err) {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    result = { ok: false, error: message };
  }
  // Streaming delivered the events live, so don't echo them in the terminal record.
  writeRecord({ kind: "result", result: { ...result, events: [] } });
  res.end();
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Build the HTTP request listener around a given engine runner (the testable seam). */
export function createRequestListener(
  run: RunAgent,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return send(res, 200, runnerInfo());
      }

      if (req.method === "POST" && req.url === "/run") {
        const raw = await readBody(req);
        let request: AgentRunRequest;
        try {
          request = raw.trim() ? (JSON.parse(raw) as AgentRunRequest) : {};
        } catch (err) {
          return send(res, 400, { ok: false, error: `Invalid JSON: ${String(err)}` });
        }

        const wantsStream = (req.headers["accept"] ?? "").includes(
          "application/x-ndjson",
        );
        if (wantsStream) {
          await runAndStream(req, res, request, run);
          return;
        }

        const result = await run(request);
        return send(res, result.ok ? 200 : 500, result);
      }

      return send(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.stack ?? err.message : String(err);
      return send(res, 500, { ok: false, error: message });
    }
  };
}

/** Create the sidecar HTTP server. Defaults to the real engine dispatch; tests pass a fake. */
export function createAgentServer(run: RunAgent = runAgent): Server {
  return createServer(createRequestListener(run));
}

// Only run as a server when this file is the process entry (`tsx src/server.ts`); importing
// it (e.g. from a test) is inert.
if (isEntrypoint(import.meta.url)) {
  // The sandbox-agent SDK can reject a background promise (e.g. an adapter install or the Daytona
  // preview SSE failing) outside any awaited path. Node's default turns that into an
  // uncaught exception that kills the whole process — taking every in-flight request with
  // it (the caller sees "Server disconnected"). Log and keep serving instead; the failing
  // run still returns its own error to its caller.
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `[sandbox-agent] unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`,
    );
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[sandbox-agent] uncaughtException: ${err.stack ?? err.message}\n`);
  });

  createAgentServer().listen(PORT, () => {
    process.stderr.write(`[sandbox-agent] http server listening on :${PORT}\n`);
  });
}
