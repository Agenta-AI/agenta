/**
 * WP-2 Pi wrapper HTTP server: the HTTP transport for the Harness port.
 *
 * Same contract as the CLI, exposed over HTTP so the wrapper can run as its own
 * container (a sidecar) that the Python service calls in-network:
 *
 *   GET  /health -> { status: "ok" }
 *   POST /run    -> body is an AgentRunRequest, response is an AgentRunResult
 *
 * Uses Node's built-in http server (no framework dependency). Pi auth comes from
 * PI_CODING_AGENT_DIR / ~/.pi/agent, mounted into the container.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { AgentRunRequest, AgentRunResult } from "./protocol.ts";
import { runPi } from "./runPi.ts";
import { runRivet } from "./runRivet.ts";

const PORT = Number(process.env.PORT ?? 8765);

// Select the engine. `rivet` drives a harness over ACP via a rivet daemon; `pi` is the
// legacy in-process Pi path. The request's explicit `backend` (set by the Python
// transport) wins; the AGENT_BACKEND env is the sidecar default; `auto` falls back to the
// request shape (a rivet request carries `harness`/`sandbox`).
const DEFAULT_BACKEND = (process.env.AGENT_BACKEND ?? "auto").toLowerCase();

function runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
  const backend = (request.backend ?? DEFAULT_BACKEND).toLowerCase();
  if (backend === "rivet") return runRivet(request);
  if (backend === "pi") return runPi(request);
  return request.harness || request.sandbox ? runRivet(request) : runPi(request);
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

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { status: "ok" });
    }

    if (req.method === "POST" && req.url === "/run") {
      const raw = await readBody(req);
      let request: AgentRunRequest;
      try {
        request = raw.trim() ? (JSON.parse(raw) as AgentRunRequest) : {};
      } catch (err) {
        return send(res, 400, { ok: false, error: `Invalid JSON: ${String(err)}` });
      }

      const result = await runAgent(request);
      return send(res, result.ok ? 200 : 500, result);
    }

    return send(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    return send(res, 500, { ok: false, error: message });
  }
});

// The rivet SDK can reject a background promise (e.g. an adapter install or the Daytona
// preview SSE failing) outside any awaited path. Node's default turns that into an
// uncaught exception that kills the whole process — taking every in-flight request with
// it (the caller sees "Server disconnected"). Log and keep serving instead; the failing
// run still returns its own error to its caller.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(
    `[pi-wrapper] unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`,
  );
});
process.on("uncaughtException", (err) => {
  process.stderr.write(`[pi-wrapper] uncaughtException: ${err.stack ?? err.message}\n`);
});

server.listen(PORT, () => {
  process.stderr.write(`[pi-wrapper] http server listening on :${PORT}\n`);
});
