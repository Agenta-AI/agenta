/**
 * WP-2 Pi wrapper CLI: the JSON transport for the Harness port.
 *
 * Reads one JSON `AgentRunRequest` from stdin, runs Pi once, and writes one JSON
 * `AgentRunResult` to stdout. stdout carries the result and nothing else; logs go
 * to stderr. This is the one-shot "json adapter" the design doc describes; a
 * long-lived RPC adapter can replace it later behind the same Python-side port.
 */
import { runPi, type AgentRunRequest, type AgentRunResult } from "./runPi.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function emit(result: AgentRunResult): void {
  process.stdout.write(JSON.stringify(result));
}

async function main(): Promise<void> {
  const raw = await readStdin();

  let request: AgentRunRequest;
  try {
    request = raw.trim() ? (JSON.parse(raw) as AgentRunRequest) : {};
  } catch (err) {
    emit({ ok: false, error: `Invalid JSON on stdin: ${String(err)}` });
    process.exit(1);
  }

  try {
    const result = await runPi(request);
    emit(result);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    emit({ ok: false, error: err instanceof Error ? err.stack ?? err.message : String(err) });
    process.exit(1);
  }
}

main();
