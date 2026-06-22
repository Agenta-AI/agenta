/**
 * Agent runner CLI: the JSON transport for the Harness port.
 *
 * Reads one JSON `AgentRunRequest` from stdin, runs the agent once, and writes one JSON
 * `AgentRunResult` to stdout. stdout carries the result and nothing else; logs go to stderr.
 * With `--stream`, writes NDJSON instead: one `{kind:"event"}` line per event the moment it
 * is built, then exactly one terminal `{kind:"result"}` line.
 *
 * `runCli(raw, stream, io)` is the testable seam: it takes the raw stdin string and an
 * injectable engine runner + output sink, and returns the exit code. Tests pass a fake engine
 * and a collecting `write`, so no stdin/stdout/process.exit mocking is needed; production
 * defaults to the real engine and `process.stdout` (which keeps streaming live).
 */
import type {
  AgentRunRequest,
  AgentRunResult,
  EmitEvent,
} from "./protocol.ts";
import { runPi } from "./engines/pi.ts";
import { runSandboxAgent } from "./engines/sandbox_agent.ts";
import { isEntrypoint } from "./entry.ts";

/** Run one request through an engine. Tests inject a fake to avoid a live harness. */
export type RunAgent = (
  request: AgentRunRequest,
  emit?: EmitEvent,
) => Promise<AgentRunResult>;

// Engine: `sandbox-agent` drives a harness over ACP. The direct `pi` engine is kept for
// local examples and tests. The request's `backend` wins, then the AGENT_BACKEND env.
const runAgent: RunAgent = (request, emit) => {
  const backend = (request.backend ?? process.env.AGENT_BACKEND ?? "sandbox-agent").toLowerCase();
  return backend === "sandbox-agent" ? runSandboxAgent(request, emit) : runPi(request, emit);
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.stack ?? err.message : String(err);
}

export interface CliIO {
  /** Engine runner; defaults to the real backend dispatch. */
  run?: RunAgent;
  /** Output sink; defaults to `process.stdout`. Called incrementally so streaming stays live. */
  write?: (chunk: string) => void;
}

/**
 * Run one request and return the process exit code (0 = ok, 1 = failure/invalid input).
 * Output is delivered through `io.write` as it is produced.
 */
export async function runCli(
  raw: string,
  stream: boolean,
  io: CliIO = {},
): Promise<number> {
  const run = io.run ?? runAgent;
  const write = io.write ?? ((chunk: string) => void process.stdout.write(chunk));

  let request: AgentRunRequest;
  try {
    request = raw.trim() ? (JSON.parse(raw) as AgentRunRequest) : {};
  } catch (err) {
    const failure: AgentRunResult = { ok: false, error: `Invalid JSON on stdin: ${String(err)}` };
    write(stream ? JSON.stringify({ kind: "result", result: failure }) + "\n" : JSON.stringify(failure));
    return 1;
  }

  if (!stream) {
    try {
      const result = await run(request);
      write(JSON.stringify(result));
      return result.ok ? 0 : 1;
    } catch (err) {
      write(JSON.stringify({ ok: false, error: errorMessage(err) }));
      return 1;
    }
  }

  const emit: EmitEvent = (event) => write(JSON.stringify({ kind: "event", event }) + "\n");
  let result: AgentRunResult;
  try {
    result = await run(request, emit);
  } catch (err) {
    result = { ok: false, error: errorMessage(err) };
  }
  // Streaming delivered the events live, so don't echo them in the terminal record.
  write(JSON.stringify({ kind: "result", result: { ...result, events: [] } }) + "\n");
  return result.ok ? 0 : 1;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const stream = process.argv.includes("--stream");
  const raw = await readStdin();
  const code = await runCli(raw, stream);
  process.exit(code);
}

// Only run when this file is the process entry (`tsx src/cli.ts`); importing it is inert.
if (isEntrypoint(import.meta.url)) {
  void main();
}
