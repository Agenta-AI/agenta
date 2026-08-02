/**
 * Load a captured QA transcript (`docs/design/agent-workflows/projects/qa/runs/*.json`) and
 * translate its request half into today's `AgentRunRequest` wire shape.
 *
 * The transcripts are real `/invoke` request/response pairs the agent-workflows QA program
 * captured against a live deployment (see `qa/matrix.md`). They are loaded in place via
 * `node:fs` at test time -- nothing here hand-copies a transcript's captured content, mirroring
 * `tests/utils/golden.ts`.
 *
 * The captured request shape is intentionally NOT what `runSandboxAgent` reads today: the QA
 * captures predate the harness-value rename (`matrix.md`'s 2026-06-25 wire-contract note) --
 * `harness: "pi"` -> today's `"pi_core"` -- and the append-system override rode
 * `harness_options.<harness>.append_system` before moving (twice, per matrix.md) to what is
 * today's `appendSystemPrompt` top-level wire field. `agentRunRequestFromTranscript` is the one
 * place that translation happens, so it stays visible rather than baked into each test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { AgentRunRequest } from "../../src/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
// services/runner/tests/utils -> repo root -> the QA program's captured run transcripts.
export const QA_RUNS_DIR = join(
  here,
  "../../../../docs/design/agent-workflows/projects/qa/runs",
);

export interface QaTranscript {
  id: string;
  group: string;
  capability: string;
  env_label: string;
  harness: string;
  model: string;
  request: {
    data: {
      inputs: { messages: Array<{ role: string; content: string }> };
      parameters: { agent: Record<string, unknown> };
    };
  };
  reply: string;
  passed: boolean;
  expect: string;
}

export function loadTranscript(name: string): QaTranscript {
  const path = join(QA_RUNS_DIR, name);
  return JSON.parse(readFileSync(path, "utf-8"));
}

// The QA captures predate the harness-value rename: the wire moved from `pi`/`agenta`/`claude`
// to today's `pi_core`/`pi_agenta`/`claude` (see `run-plan.ts`'s `acpAgent` derivation, which
// requires exactly these three values).
const HARNESS_RENAME: Record<string, string> = {
  pi: "pi_core",
  agenta: "pi_agenta",
  claude: "claude",
};

/**
 * Build today's `AgentRunRequest` from a captured transcript's request half.
 *
 * `tools: [{type: "builtin", name}]` is unchanged across wire generations and maps straight to
 * the wire's `tools: string[]`. `harness_options.<capturedHarness>.append_system` maps to the
 * wire's top-level `appendSystemPrompt` (Pi-only field; see `protocol.ts`).
 */
export function agentRunRequestFromTranscript(
  transcript: QaTranscript,
): AgentRunRequest {
  const agent = transcript.request.data.parameters.agent as {
    harness?: string | { kind?: string };
    sandbox?: string | { kind?: string };
    model?: string;
    llm?: { model?: string };
    agents_md?: string;
    instructions?: { agents_md?: string };
    tools?: Array<{ type: string; name: string }>;
    harness_options?: Record<string, { append_system?: string }>;
  };
  const capturedHarness =
    typeof agent.harness === "string"
      ? agent.harness
      : (agent.harness?.kind ?? "pi");
  const harness = HARNESS_RENAME[capturedHarness] ?? capturedHarness;
  const appendSystemPrompt =
    agent.harness_options?.[capturedHarness]?.append_system;
  const builtinTools = (agent.tools ?? [])
    .filter((tool) => tool.type === "builtin")
    .map((tool) => tool.name);

  return {
    harness,
    sandbox: "local",
    agentsMd: agent.agents_md ?? agent.instructions?.agents_md,
    model: agent.model ?? agent.llm?.model,
    appendSystemPrompt,
    tools: builtinTools,
    messages: transcript.request.data.inputs.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
}
