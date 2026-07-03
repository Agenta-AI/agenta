---
title: What happens to instructions.agents_md in the claude harness (and why the summarizer acts like a coding CLI)
task: agents-md-claude
date: 2026-07-01
---

# `instructions.agents_md` in the claude harness

Scope: how an agent's `instructions.agents_md` is carried from the SDK harness adapter, over
the `/run` wire, through the TypeScript runner, and into Claude Code (via the `sandbox-agent`
daemon + the Zed `claude-agent-acp` adapter + `@anthropic-ai/claude-agent-sdk`). Read-only.

## Symptom

An agent configured `harness: claude` with `instructions.agents_md` = "You are a text
summarizer, summarize the text, no questions back". Sent a bare pasted paragraph (no
instruction verb), it replied like the Claude Code CLI ("Is there something I can help you
with, a coding task or something else?") instead of summarizing. The user's read:
"agents.md is not considered at all in claude, it ignores it."

## Verdict

The user is **effectively right, for a precise mechanical reason**: for the claude harness,
`agents_md` is delivered **only as an `AGENTS.md` file in the run's cwd**, but the bundled
`@anthropic-ai/claude-agent-sdk@0.2.83` **auto-loads `CLAUDE.md` files only, never
`AGENTS.md`**. So the file is written but never read. It is also **not** passed as a system
prompt (that path is Pi-only). Net effect: for claude, `agents_md` is written-then-ignored —
dropped in practice. And even if it *were* loaded (as a `CLAUDE.md`), it would land as weak
project *memory* underneath Claude Code's full `claude_code` persona preset, which is exactly
the coding-CLI voice in the symptom.

## The trace (file:line)

### 1. SDK harness adapter — agents_md set, no system prompt for claude
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py:101-112` — `ClaudeHarness._to_harness_config`
  builds `ClaudeAgentTemplate(agents_md=config.agent.instructions, ...)`. It sets **no**
  `system` / `append_system` — those are Pi-only extras (see `PiHarness` at
  `harnesses.py:78-79` and `AgentaHarness` at `:143-144`). So the user's raw `instructions`
  becomes `agents_md` and nothing else.
- Contrast `agenta_builtins.py:331-340`: for pi_agenta, `compose_instructions` prepends
  `AGENTA_PREAMBLE` into AGENTS.md **and** `compose_append_system` builds a persona
  `append_system`. Claude gets neither the preamble nor an append.

### 2. Wire — claude carries `agentsMd`, never `systemPrompt`
- Golden `sdks/python/oss/tests/pytest/unit/agents/golden/run_request.claude.json:5` —
  `"agentsMd": "..."`, and it carries **no** `systemPrompt`/`appendSystemPrompt` (0 hits).
- Golden `run_request.pi_core.json:73-74` — pi *does* carry `systemPrompt`/`appendSystemPrompt`.
- `services/agent/src/protocol.ts:366-379` — the wire doc itself says `systemPrompt` /
  `appendSystemPrompt` are **"Pi only"**; `agentsMd` is "AGENTS.md text injected as the
  agent's instructions".

### 3. Runner run-plan — systemPrompt/append are gated behind `isPi`
- `services/agent/src/engines/sandbox_agent/run-plan.ts:297-302` —
  `systemPrompt = isPi ? request.systemPrompt : undefined` and same for `appendSystemPrompt`.
  For claude (`acpAgent === "claude"`, `isPi === false`) **both are `undefined`**.
- `run-plan.ts:327` — `agentsMd: request.agentsMd?.trim() || undefined` is put on the plan.
  That is the *only* channel `agents_md` survives on for claude.

### 4. Runner workspace — agents_md becomes an `AGENTS.md` file
- `services/agent/src/engines/sandbox_agent/workspace.ts:80` (local) and `:54-56` (daytona) —
  `writeFileSync(join(cwd, "AGENTS.md"), plan.agentsMd)`. Written as **AGENTS.md**, always.
- `buildTurnText` (`transcript.ts:69-81`) does **not** fold `agents_md` into the prompt for
  any harness — it only replays history + the latest user message. So for claude the *only*
  place `agents_md` exists at run time is the `AGENTS.md` file on disk.

### 5. Session creation — no system prompt passed; base persona is the claude_code preset
- `services/agent/src/engines/sandbox_agent.ts:453-457` —
  `createSession({ agent: "claude", cwd, sessionInit: { cwd, mcpServers } })`. No system
  prompt, no memory hint. The session's cwd is the temp dir that holds `AGENTS.md`.
- Zed adapter `@zed-industries/claude-agent-acp@0.23.1/dist/acp-agent.js`:
  - `:923` — base `systemPrompt = { type: "preset", preset: "claude_code" }` (the full
    Claude Code coding-CLI persona) unless `params._meta.systemPrompt` is provided;
  - `:924-933` — it *would* honor `_meta.systemPrompt` (a string replaces, or `.append` adds);
  - `:954` — `settingSources: ["user", "project", "local"]`.

### 6. The load gap — settingSources loads CLAUDE.md, but the file is AGENTS.md
- `@anthropic-ai/claude-agent-sdk@0.2.83/sdk.d.ts:1211` — settingSources "Must include
  `'project'` to load **CLAUDE.md** files." The adapter includes project+local, so CLAUDE.md
  *would* load.
- The memory-file loader in `.../claude-agent-sdk/cli.js` (function `Vj`) collects, per
  ancestor dir: `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules`, and `CLAUDE.local.md`.
  **`AGENTS.md` is never in the loader.** The only two `AGENTS.md` strings in `cli.js`
  (lines 4756, 4818) are inside the `/init` command prompt (telling Claude to *read* an
  existing AGENTS.md when it writes a CLAUDE.md) — not the auto-load path.
- Result: the runner writes `AGENTS.md`; the SDK looks for `CLAUDE.md`; they never meet.

### 7. No available system-prompt lever through sandbox-agent 0.4.2
- `sandbox-agent@0.4.2/dist/index.d.ts:2950-2960` — `SessionCreateRequest.sessionInit` is
  `Omit<NewSessionRequest, "_meta">`. `_meta` is explicitly **stripped**, and there is no
  `systemPrompt`/append option on `createSession` (only `model`/`mode`/`thoughtLevel`). So the
  runner, on this daemon version, **cannot** reach the Zed adapter's `_meta.systemPrompt.append`
  hook even though the adapter supports it. The filesystem (a memory file) is the runner's only
  delivery channel to claude today.

## Root cause

Two compounding faults:

1. **Delivery mismatch (primary, "ignored"):** claude's `agents_md` is materialized as
   `AGENTS.md`, but `claude-agent-sdk@0.2.83` auto-loads `CLAUDE.md` only. The instruction is
   written to a filename the harness never reads → dropped in effect. This is the literal
   reason the user sees no influence.
2. **Strength/altitude (secondary, "overridden"):** even loaded (as a CLAUDE.md), `agents_md`
   is project *memory* sitting under the `claude_code` **system-prompt preset**. For a bare,
   verb-less paste the coding-CLI persona dominates and the model asks "what can I help with?".
   The runner never threads `agents_md` into the SDK's `systemPrompt` (Pi-only path;
   `run-plan.ts:297-302`), and sandbox-agent 0.4.2 exposes no hook for it (#7 above), so the
   strongest lever is unused.

So "agents.md is not considered at all in claude" is **true as an observation**; the mechanism
is "written to the wrong filename for the loader," not "the field is discarded in the mapper."

## Fixes at the source

Ordered by effort; #A alone makes `agents_md` actually take effect.

- **A. Write a CLAUDE.md for the claude harness** (smallest, works with the current stack).
  In `workspace.ts`, for the claude ACP agent write `plan.agentsMd` to `CLAUDE.md` (or
  `.claude/CLAUDE.md`) instead of / in addition to `AGENTS.md`. `settingSources` already
  includes `project`+`local` (adapter `:954`), so the SDK's memory loader picks it up. This
  turns "ignored" into "considered as project memory." (Pi keeps AGENTS.md — Pi reads that.)
- **B. Deliver agents_md as an appended system prompt** (makes it override the coding persona
  for ambiguous input). The Zed adapter already honors `_meta.systemPrompt = { type:"preset",
  preset:"claude_code", append: <agents_md> }` (`acp-agent.js:924-933`). Blocked today by
  sandbox-agent 0.4.2 stripping `_meta` from `sessionInit` (#7); needs sandbox-agent to expose
  a `systemPrompt`/append option on `createSession`, then `run-plan.ts` to stop gating the
  append behind `isPi` for claude and `sandbox_agent.ts:453` to pass it. This is the real fix
  for the persona problem, but it is a cross-package change.
- **C. Do both** — a `CLAUDE.md` for durable project context *and* an appended system prompt
  for persona-level instructions, mirroring Pi's two-layer split (AGENTS.md preamble +
  append_system persona in `agenta_builtins.py`).

## Kit-level workaround (already in use)

Frame the task explicitly in the message: "Summarize the following text:\n<paragraph>" rather
than relying on `agents_md` to install the persona. With an explicit instruction verb the
coding-CLI persona still answers the task correctly; only the bare, verb-less paste falls
through to "how can I help?". This is a message-composition workaround, not a fix — the
underlying delivery mismatch (#A) is the thing to correct.
