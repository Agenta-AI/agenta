# Research

Date: 2026-07-01
Source: [`../../../scratch/console/builder-kit/findings/agents-md-claude.md`](../../../scratch/console/builder-kit/findings/agents-md-claude.md)

Read-only trace of how `instructions.agents_md` travels from the SDK harness adapter, over the
`/run` wire, through the runner, and into Claude Code. The instruction is written to disk and
never read. It is a filename mismatch, not a dropped field.

## The trace (file:line)

### 1. SDK harness adapter, agents_md set, no system prompt for claude

`ClaudeHarness._to_harness_config`
(`sdks/python/agenta/sdk/agents/adapters/harnesses.py:101-112`) builds
`ClaudeAgentTemplate(agents_md=config.agent.instructions, ...)`. It sets no `system` /
`append_system`; those are Pi-only extras (`PiHarness` at `harnesses.py:78-79`, `AgentaHarness`
at `:143-144`). So the user's raw `instructions` becomes `agents_md` and nothing else. Claude
gets neither the Agenta preamble nor a persona append that pi_agenta gets from
`agenta_builtins.py:331-340`.

### 2. Wire, claude carries `agentsMd`, never `systemPrompt`

- Golden `sdks/python/oss/tests/pytest/unit/agents/golden/run_request.claude.json:5` , 
  `"agentsMd": "..."`, and no `systemPrompt`/`appendSystemPrompt`.
- Golden `run_request.pi_core.json:73-74`, pi does carry `systemPrompt`/`appendSystemPrompt`.
- `services/agent/src/protocol.ts:366-379`, the wire doc says `systemPrompt` /
  `appendSystemPrompt` are "Pi only"; `agentsMd` is "AGENTS.md text injected as the agent's
  instructions."

### 3. Runner run-plan, systemPrompt/append gated behind `isPi`

- `services/agent/src/engines/sandbox_agent/run-plan.ts:297-302` , 
  `systemPrompt = isPi ? request.systemPrompt : undefined`, same for `appendSystemPrompt`. For
  claude (`isPi === false`) both are `undefined`.
- `run-plan.ts:327`, `agentsMd: request.agentsMd?.trim() || undefined` is put on the plan.
  That is the only channel `agents_md` survives on for claude.

### 4. Runner workspace, agents_md becomes an `AGENTS.md` file (the write site)

- `services/agent/src/engines/sandbox_agent/workspace.ts:80` (local) and `:54-56` (Daytona) , 
  `writeFileSync(join(cwd, "AGENTS.md"), plan.agentsMd)`. Written as **AGENTS.md**, always, for
  every harness.
- `buildTurnText` (`transcript.ts:69-81`) does not fold `agents_md` into the prompt for any
  harness. So for claude the only place `agents_md` exists at run time is the `AGENTS.md` file
  on disk.

### 5. Session creation, no system prompt; base persona is the claude_code preset

- `services/agent/src/engines/sandbox_agent.ts:453-457` , 
  `createSession({ agent: "claude", cwd, sessionInit: { cwd, mcpServers } })`. No system
  prompt, no memory hint. The cwd is the temp dir that holds `AGENTS.md`.
- Zed adapter `@zed-industries/claude-agent-acp@0.23.1/dist/acp-agent.js`: `:923` base
  `systemPrompt = { type: "preset", preset: "claude_code" }` (the full coding-CLI persona)
  unless `params._meta.systemPrompt` is given; `:924-933` it would honor `_meta.systemPrompt`;
  `:954` `settingSources: ["user", "project", "local"]`.

### 6. The load gap, settingSources loads CLAUDE.md, but the file is AGENTS.md

- `@anthropic-ai/claude-agent-sdk@0.2.83/sdk.d.ts:1211`, settingSources "Must include
  `'project'` to load **CLAUDE.md** files." The adapter includes project+local, so a `CLAUDE.md`
  at the cwd root **would** load.
- The memory-file loader in `.../claude-agent-sdk/cli.js` (function `Vj`) collects, per ancestor
  dir: `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules`, `CLAUDE.local.md`. **`AGENTS.md` is
  never in the loader.** The only two `AGENTS.md` strings in `cli.js` (lines 4756, 4818) are
  inside the `/init` command prompt, not the auto-load path.
- Result: the runner writes `AGENTS.md`; the SDK looks for `CLAUDE.md`; they never meet.

### 7. No system-prompt lever through sandbox-agent 0.4.2

- `sandbox-agent@0.4.2/dist/index.d.ts:2950-2960`, `SessionCreateRequest.sessionInit` is
  `Omit<NewSessionRequest, "_meta">`. `_meta` is stripped, and there is no
  `systemPrompt`/append option on `createSession`. So the runner, on this daemon version,
  cannot reach the Zed adapter's `_meta.systemPrompt.append` hook even though the adapter
  supports it. The filesystem (a memory file) is the runner's only delivery channel to claude
  today.

## Root cause

Two compounding faults, one primary:

1. **Delivery mismatch (primary, "ignored").** claude's `agents_md` is materialized as
   `AGENTS.md`, but `claude-agent-sdk@0.2.83` auto-loads `CLAUDE.md` only. The instruction is
   written to a filename the harness never reads, so it is dropped in effect. This is the
   literal reason the user sees no influence, and the thing the fix corrects.
2. **Strength/altitude (secondary, "overridden").** Even loaded as a `CLAUDE.md`, `agents_md`
   is project *memory* sitting under the `claude_code` system-prompt preset. For a bare,
   verb-less paste the coding-CLI persona dominates and the model asks "what can I help with?".
   The runner never threads `agents_md` into the SDK's `systemPrompt` (Pi-only path,
   `run-plan.ts:297-302`), and sandbox-agent 0.4.2 exposes no hook for it (#7 above).

So "agents.md is not considered at all in claude" is true as an observation. The mechanism is
"written to the wrong filename for the loader," not "the field is discarded in the mapper."

## Why the persona `_meta` path is out of scope

Fault #2 is the deeper fix: deliver `agents_md` as an *appended system prompt* so it overrides
the coding persona for ambiguous input. The Zed adapter already honors
`_meta.systemPrompt = { type: "preset", preset: "claude_code", append: <agents_md> }`
(`acp-agent.js:924-933`). But it is blocked today: sandbox-agent 0.4.2 strips `_meta` from
`sessionInit` (#7), so the runner cannot reach that hook. Unblocking it is a cross-package
change (sandbox-agent must expose a `systemPrompt`/append option on `createSession`, then
`run-plan.ts` must stop gating the append behind `isPi` for claude, then `sandbox_agent.ts:453`
must pass it). That is a separate, larger fix and is not in this workspace. See fault #2 and the
kit-level workaround below.

## Kit-level workaround (already in use, not a fix)

Frame the task explicitly in the message: "Summarize the following text:\n<paragraph>" rather
than relying on `agents_md` to install the persona. With an explicit instruction verb the
coding-CLI persona still answers the task correctly; only the bare, verb-less paste falls
through to "how can I help?". This is message composition, not a fix. The delivery mismatch
above is the thing to correct.
