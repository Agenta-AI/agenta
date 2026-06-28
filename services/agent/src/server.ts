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
import { timingSafeEqual } from "node:crypto";
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
import {
  destroyInFlightSandboxes,
  runSandboxAgent,
} from "./engines/sandbox_agent.ts";
import { runnerInfo } from "./version.ts";
import { isEntrypoint } from "./entry.ts";
import { startAliveWatchdog } from "./sessions/alive.ts";
import { buildPersistingEmitter } from "./sessions/persist.ts";

const PORT = Number(process.env.AGENTA_AGENT_RUNNER_PORT ?? 8765);

// Bind to loopback by default (sidecar-trust step 1): the `/run` body carries plaintext
// provider secrets and reusable bearer tokens, so the sidecar MUST sit on a trusted,
// non-public network. `127.0.0.1` keeps it reachable only from the same host (the co-located
// Python service) and never `0.0.0.0`. In Kubernetes/Compose, set `AGENTA_AGENT_RUNNER_HOST`
// to the private pod/internal-network interface; never publish the port to the host.
const HOST = process.env.AGENTA_AGENT_RUNNER_HOST ?? "127.0.0.1";

// Optional shared `/run` token (sidecar-trust step 2): default OFF. When
// `AGENTA_AGENT_RUNNER_TOKEN` is set, every `/run` request must present the same secret (in
// `Authorization: Bearer <token>` or `X-Agenta-Runner-Token: <token>`); otherwise it is
// rejected with 401. Cheap defense-in-depth against accidental exposure on top of network
// isolation; a static shared secret is not a substitute for TLS (deferred). Unset = no check,
// so co-located/loopback deployments are unaffected.
const RUNNER_TOKEN_ENV = "AGENTA_AGENT_RUNNER_TOKEN";

/** Constant-time string compare so the token check does not leak length/prefix via timing. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The bearer/token a caller presented, from either accepted header. Empty string if none. */
function presentedToken(req: IncomingMessage): string {
  const header = req.headers["x-agenta-runner-token"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers["authorization"];
  // Linear scan, not a regex: `/^Bearer\s+(.+)$/` is polynomial-ReDoS (js/polynomial-redos) —
  // `\s+` and `.+` both match spaces, so a long all-space header backtracks in O(n^2) and stalls
  // the single-threaded runner. The fixed `^Bearer\s` prefix has no ambiguous quantifier (O(n));
  // `slice(6).trim()` then yields the same token `\s+(.+)` did.
  if (typeof auth === "string" && /^Bearer\s/i.test(auth)) {
    const token = auth.slice(6).trim();
    if (token) return token;
  }
  return "";
}

/**
 * Whether this `/run` request is authorized. The check is OFF unless the operator opts in by
 * setting `AGENTA_AGENT_RUNNER_TOKEN`; when set, the presented token must match exactly.
 */
function isAuthorized(req: IncomingMessage): boolean {
  const expected = process.env[RUNNER_TOKEN_ENV];
  if (!expected) return true; // default-off: no token configured, accept (network isolation only)
  return tokensMatch(presentedToken(req), expected);
}

/** Run one request through an engine. Tests inject a fake to avoid a live harness. */
export type RunAgent = (
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
) => Promise<AgentRunResult>;

/**
 * Whether this request is session-owned (detached run that the runner coordinates).
 * Both `sessionId` and `runId` must be present; an empty string counts as absent.
 */
function isSessionOwned(request: AgentRunRequest): boolean {
  return !!(
    request.sessionId?.trim() &&
    request.runId?.trim()
  );
}

/** Resolve the project_id for session coordination calls. Falls back to "" gracefully. */
function resolveProjectId(request: AgentRunRequest): string {
  return request.projectId?.trim() ?? "";
}

// One engine: `sandbox-agent` drives a harness (Pi or Claude) over ACP. The harness is
// selected by `request.harness`, not by an engine selector.
const runAgent: RunAgent = (request, emit, signal) =>
  runSandboxAgent(request, emit, signal);

/**
 * Stream a run as NDJSON: one `{kind:"event"}` line per event the moment it is built, then
 * exactly one terminal `{kind:"result"}` line (success or failure). Selected by the caller
 * with `Accept: application/x-ndjson`; the one-shot `/run` path is left untouched.
 *
 * For session-owned runs (sessionId + runId present):
 *  - the run survives client disconnect (abort is NOT wired to the response close event);
 *  - every event is persisted producer-side via the transcript ingest endpoint;
 *  - an alive-lock watchdog heartbeats the coordination plane for the run's lifetime.
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

  const sessionOwned = isSessionOwned(request);
  const sessionId = request.sessionId!;
  const runId = request.runId!;
  const projectId = resolveProjectId(request);

  // Session-owned runs survive client disconnect — the runner owns the run. Non-session
  // runs abort on disconnect (original behavior: caller drives, disconnect = cancel).
  const controller = new AbortController();
  if (!sessionOwned) {
    // Listen on the response, not the request: the request body is already fully read, so
    // its `close` can fire early on a keep-alive connection. `res` `close` fires when the
    // response connection ends — after a normal `res.end()` (harmless: the run is already
    // done) or when the client drops mid-stream (the case we want to cancel).
    res.on("close", () => controller.abort());
  }

  const writeRecord = (record: StreamRecord): void => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(record) + "\n");
  };
  const liveEmit: EmitEvent = (event) => writeRecord({ kind: "event", event });

  // For session-owned runs: wrap the live emitter so every event is also persisted
  // producer-side, independent of whether the client is still connected.
  let emitFn: EmitEvent = liveEmit;
  let flushPersist: (() => Promise<void>) | undefined;
  let aliveWatchdog: { release: () => Promise<void> } | undefined;

  if (sessionOwned) {
    const { emit: persistingEmit, flush } = buildPersistingEmitter(
      sessionId,
      projectId,
      liveEmit,
    );
    emitFn = persistingEmit;
    flushPersist = flush;
    aliveWatchdog = startAliveWatchdog(sessionId, runId, projectId);
  }

  let result: AgentRunResult;
  try {
    result = await run(request, emitFn, controller.signal);
    // Drain all queued persists before the sandbox tears down.
    if (flushPersist) await flushPersist();
  } catch (err) {
    if (flushPersist) await flushPersist().catch(() => {});
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    result = { ok: false, error: message };
  } finally {
    // Release the alive lock and mark the stream row ended.
    if (aliveWatchdog) await aliveWatchdog.release().catch(() => {});
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
        if (!isAuthorized(req)) {
          return send(res, 401, { ok: false, error: "Unauthorized" });
        }
        const raw = await readBody(req);
        let request: AgentRunRequest;
        try {
          request = raw.trim() ? (JSON.parse(raw) as AgentRunRequest) : {};
        } catch (err) {
          return send(res, 400, {
            ok: false,
            error: `Invalid JSON: ${String(err)}`,
          });
        }

        const wantsStream = (req.headers["accept"] ?? "").includes(
          "application/x-ndjson",
        );
        if (wantsStream) {
          await runAndStream(req, res, request, run);
          return;
        }

        // DEVELOPMENT-ONLY: the one-shot JSON path. The live agent always requests NDJSON
        // (Accept: application/x-ndjson) and the SDK coalesces the batch result from the
        // stream. This coalesced JSON response is kept only for local debugging of /run; no
        // live caller hits it. Do not build new behavior on this branch.
        const result = await run(request);
        return send(res, result.ok ? 200 : 500, result);
      }

      return send(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      const message =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      return send(res, 500, { ok: false, error: message });
    }
  };
}

/** Create the sidecar HTTP server. Defaults to the real engine dispatch; tests pass a fake. */
export function createAgentServer(run: RunAgent = runAgent): Server {
  return createServer(createRequestListener(run));
}

/**
 * Register a shutdown handler that best-effort deletes any in-flight sandbox(es) before exit.
 *
 * Without this, `docker stop` (SIGTERM) kills the process while the per-run `finally` in
 * `runSandboxAgent` is still waiting on the harness — so the sandbox it created is never deleted
 * and leaks (a Daytona credit-burner). The handler drains the in-flight registry, then exits.
 *
 * It is timeout-bounded so it can NEVER hang shutdown: `destroyInFlightSandboxes` races the
 * deletes against its own timeout, and if the SIGTERM grace period elapses the orchestrator's
 * SIGKILL ends the process anyway (the Daytona auto-stop backstop in `provider.ts` covers that
 * unreachable case). The handler installs once and is idempotent against a repeated signal.
 *
 * Injectable (`onCleanup` / `exit`) so a test can drive it without killing the test process.
 */
export function registerShutdownHandler({
  onCleanup = destroyInFlightSandboxes,
  exit = (code: number) => process.exit(code),
  signals = ["SIGTERM", "SIGINT"] as const,
}: {
  onCleanup?: (timeoutMs?: number) => Promise<void>;
  exit?: (code: number) => void;
  signals?: readonly NodeJS.Signals[];
} = {}): void {
  let shuttingDown = false;
  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return; // a second signal must not race a second cleanup
    shuttingDown = true;
    process.stderr.write(
      `[sandbox-agent] received ${signal}, cleaning up in-flight sandboxes\n`,
    );
    void onCleanup()
      .catch(() => {})
      .finally(() => exit(0));
  };
  for (const signal of signals) process.on(signal, handle);
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
    process.stderr.write(
      `[sandbox-agent] uncaughtException: ${err.stack ?? err.message}\n`,
    );
  });

  // On `docker stop` (SIGTERM) / Ctrl-C (SIGINT), delete any sandbox a run created before the
  // process exits, so a kill mid-run does not leak the sandbox (the per-run `finally` never
  // runs when the process is killed).
  registerShutdownHandler();

  createAgentServer().listen(PORT, HOST, () => {
    process.stderr.write(
      `[sandbox-agent] http server listening on ${HOST}:${PORT}\n`,
    );
  });
}
