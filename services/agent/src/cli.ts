/**
 * WP-2 Pi wrapper CLI: the JSON transport for the Harness port.
 *
 * Reads one JSON `AgentRunRequest` from stdin, runs Pi once, and writes one JSON
 * `AgentRunResult` to stdout. stdout carries the result and nothing else; logs go
 * to stderr. This is the one-shot "json adapter" the design doc describes; a
 * long-lived RPC adapter can replace it later behind the same Python-side port.
 */
import type {
  AgentRunRequest,
  AgentRunResult,
  EmitEvent,
  StreamRecord,
} from "./protocol.ts";
import { runPi } from "./engines/pi.ts";
import { runRivet } from "./engines/rivet.ts";

// Engine: `rivet` drives a harness over ACP via a rivet daemon; `pi` (default) is the
// legacy in-process Pi path. The request's `backend` wins, then the AGENT_BACKEND env.
function runAgent(
  request: AgentRunRequest,
  emit?: EmitEvent,
): Promise<AgentRunResult> {
  const backend = (request.backend ?? process.env.AGENT_BACKEND ?? "pi").toLowerCase();
  return backend === "rivet" ? runRivet(request, emit) : runPi(request, emit);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// One-shot mode: the whole result as a single JSON document (the `/invoke` contract).
function emitResult(result: AgentRunResult): void {
  process.stdout.write(JSON.stringify(result));
}

// Streaming mode (`--stream`): one NDJSON record per line — an `{kind:"event"}` line the
// moment each event is built, then exactly one terminal `{kind:"result"}` line.
function writeRecord(record: StreamRecord): void {
  process.stdout.write(JSON.stringify(record) + "\n");
}

async function main(): Promise<void> {
  const stream = process.argv.includes("--stream");
  const raw = await readStdin();

  let request: AgentRunRequest;
  try {
    request = raw.trim() ? (JSON.parse(raw) as AgentRunRequest) : {};
  } catch (err) {
    const failure: AgentRunResult = { ok: false, error: `Invalid JSON on stdin: ${String(err)}` };
    if (stream) writeRecord({ kind: "result", result: failure });
    else emitResult(failure);
    process.exit(1);
  }

  if (!stream) {
    try {
      const result = await runAgent(request);
      emitResult(result);
      process.exit(result.ok ? 0 : 1);
    } catch (err) {
      emitResult({
        ok: false,
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      });
      process.exit(1);
    }
    return;
  }

  const emit: EmitEvent = (event) => writeRecord({ kind: "event", event });
  let result: AgentRunResult;
  try {
    result = await runAgent(request, emit);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.stack ?? err.message : String(err) };
  }
  // Streaming delivered the events live, so don't echo them in the terminal record.
  writeRecord({ kind: "result", result: { ...result, events: [] } });
  process.exit(result.ok ? 0 : 1);
}

main();
