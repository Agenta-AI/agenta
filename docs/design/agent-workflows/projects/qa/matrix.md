# Agent-workflows QA matrix and scenarios

The product of environment, harness, and capability. The first half is the coverage matrix
that says which cells are real. The second half is the Gherkin scenarios that say how to run
each one and what a pass looks like. See `README.md` for how to configure and run each axis.

## Legend

Environments: `E1` service / in-process Pi, `E2` service / sandbox-agent local, `E3` service / sandbox-agent
Daytona, `E4` SDK-direct over the local Node runner CLI (`SandboxAgentBackend(cwd=services/agent)`).

> **E4 is NOT in-process Pi.** The in-process SDK backend was renamed `InProcessPiBackend` ->
> `LocalBackend` and is currently a stub (`create_sandbox` / `create_session` raise
> `NotImplementedError`; in-process Pi and Claude are a later phase — see F-018 in
> `findings.md`). The only working SDK-direct path is `SandboxAgentBackend` driving the
> TypeScript runner CLI as a subprocess. So an "E4" cell exercises the same wire and runner as
> E2, just invoked from a host script instead of the service. The older "E1 in-process Pi
> contrast" notes refer to a direct-Pi batch run outside the SDK; that contrast is now blocked
> on `LocalBackend` from the SDK.

Harnesses: `pi`, `agenta`, `claude`.

Cell codes:

- `valid` the cell exists and should be tested.
- `n/a` the cell cannot exist (the harness or backend does not support it).
- `blocked:<reason>` the cell is valid but cannot run until a precondition is met.
- `pass` / `fail` filled in as runs happen, with a link to the run capture or finding.

## Validity rules (why cells are n/a or blocked)

These come from the code and the prior `feature-matrix-test.md` run. They are the reason
the full product is much smaller than it looks.

1. **In-process Pi does not support Claude.** The in-process Pi path is harness `{pi, agenta}`
   only; Claude only runs on sandbox-agent (E2, E3). So every `claude` cell on E1 is `n/a`.
   E4 (SDK-direct) runs through `SandboxAgentBackend`, which does support Claude, so a `claude`
   E4 cell is valid (modulo the Anthropic-key precondition). The in-process SDK backend that the
   old E1 contrast used (`InProcessPiBackend`) was renamed `LocalBackend` and is now a stub, so
   it cannot be the E4 backend (F-018).
2. **Claude is blocked on an Anthropic key.** The harness is wired but returns HTTP 500
   `claude: model authentication failed` with no Anthropic key in the project vault. Every
   `claude` cell is `blocked:anthropic-key` until a key is added.
3. **Builtin tools are a Pi concept.** `pi` and `agenta` deliver Pi builtins (`bash`,
   `read`, `write`, `edit`). Claude has no Pi builtins; it gets tools over MCP only. So
   builtin-tool cells on `claude` are `n/a`.
4. **Skills load on either Pi harness, not just `agenta`.** As of 2026-06-24 the `skills`
   field carries an author-supplied `SkillConfig` (inline or `@ag.embed`) on any Pi-family
   harness, so F-003 is unblocked: skills are no longer forced-only and are no longer an
   `agenta`-only feature. The `pi_agenta` harness additionally *forces* `read`+`bash` (which is
   what makes Pi surface a skill), but a plain `pi_core` run that supplies the same forced
   tools loads and invokes author skills too — verified live 2026-06-25 on `pi_core` (F-028).
   So skill cells are `valid` on both `pi` and `agenta` (the runner materializes skills for the
   `pi` ACP agent that both drive). On Claude the runner drops them by design (it materializes
   skills for Pi only) and logs a warning when it does (F-015, resolved 2026-06-24), so Claude
   skill cells stay `n/a`/`dropped`. The remaining `agenta`-vs-`pi` difference is the forced
   tool set, not skill support.
5. **MCP is delivered to non-Pi harnesses only, and is flag-gated.** Per `ground-truth.md`
   MCP delivery exists through the stdio bridge for non-Pi harnesses, and in-process Pi
   reports `mcpTools: false`. So MCP is `valid` on `claude` (sandbox-agent) and `n/a` or
   to-be-verified on `pi`/`agenta`. Every MCP cell is also `blocked:mcp-flag` until
   `AGENTA_AGENT_ENABLE_MCP=true`, and `blocked:stdio-server` until a reachable stdio MCP
   server is configured. Because MCP currently lands on Claude, it inherits
   `blocked:anthropic-key` too. Whether `pi` over sandbox-agent can take MCP is an open question the
   run should answer.
6. **Gateway tools need a Composio connection.** A `gateway` tool resolves to a callback to
   `/tools/call`, but it only does anything if a real Composio integration, action, and
   connection are configured. Every gateway cell is `blocked:composio-connection` until one
   exists.
7. **Client tools need the `/messages` path.** A `client` tool resolves to a callback the
   browser chat answers. The batch `/invoke` path has no client to call back. Client-tool
   cells are `n/a` on `/invoke` and must run on `/messages` with a simulated client.
8. **Remote (http) MCP servers are skipped by the runner.** Only stdio MCP is on the active
   path. http MCP cells are `n/a` this release.
9. **Daytona is slower but not different.** E3 should match E2 functionally. A capability
   that passes on E2 but fails on E3 is a sandbox-provisioning finding, not a logic one.

## Coverage matrix

Baseline capabilities (chat, instructions, model override) were green on pi and agenta
across E1, E2, E3 in the prior run. They stay as smoke checks. The cells below are the ones
this QA program must drive. `?` means status unknown until run.

### Capability x harness (validity, before runs)

| Capability | pi | agenta | claude |
| --- | --- | --- | --- |
| chat / instructions / model override | valid | valid | blocked:anthropic-key |
| builtin tools (bash/read) | valid | valid (forced) | n/a |
| code tools | valid | valid | blocked:anthropic-key |
| gateway tools (Composio) | blocked:composio-connection | blocked:composio-connection | blocked:composio-connection + anthropic-key |
| MCP (stdio) | n/a? verify | n/a? verify | blocked:mcp-flag + stdio-server + anthropic-key |
| skills without code | valid | valid (forced) | n/a |
| skills with code | valid | valid | n/a |
| skill invocation (author config) | valid (with forced read+bash; F-028) | valid (inline + embed) | dropped by design (warns; F-015 resolved) |
| client tools | n/a on /invoke | n/a on /invoke | n/a on /invoke |

### Valid cell x environment (where each valid capability should run)

| Capability / harness | E1 in-proc Pi | E2 sandbox-agent local | E3 sandbox-agent Daytona | E4 SDK-direct (SandboxAgentBackend CLI) |
| --- | --- | --- | --- | --- |
| code tool / pi | valid | valid | valid | valid |
| code tool / agenta | valid | valid | valid | valid |
| code tool / claude | n/a | blocked:anthropic-key | blocked:anthropic-key | blocked:anthropic-key |
| builtin bash / pi | valid | valid | valid | valid |
| skill no-code / agenta | valid | valid | valid | valid |
| skill with-code / agenta | valid | valid | valid | valid |
| skill invocation / agenta | valid | valid | materializes; run blocked:daytona-model-auth | valid |
| gateway tool / pi | blocked:composio | blocked:composio | blocked:composio | blocked:composio |
| MCP / claude | n/a | blocked (key+flag+server) | blocked (key+flag+server) | blocked (key+flag+server) |
| append_system / pi | valid | known-fail (F-001) | known-fail (F-001) | valid |

This table is the live scoreboard. Replace `valid` with `pass` or `fail` as runs complete
and link the run capture or the finding id.

## Gherkin scenarios

Conventions for every scenario:

- "forces the capability" means the prompt can only be answered by using it. Pick a token
  the model cannot guess. A magic number from a script, a record only an MCP server has, a
  value only a tool returns.
- A pass requires both the right answer and evidence the capability was actually used (a
  tool-call event, script stdout, a file side effect). Text that merely looks right is a
  soft pass at best, and a fail if the evidence is absent.
- Run each scenario in every environment its row marks `valid`. Use the Examples table.

### Smoke: chat, instructions, model override

```gherkin
Scenario Outline: the agent obeys instructions and the model override
  Given an agent with harness <harness> on environment <env>
    And agents_md "Reply with exactly the word PONG and nothing else."
    And model override "<model>"
  When I send "ping"
  Then the reply is exactly "PONG"
    And the response carries a span_id and a trace_id

  Examples:
    | harness | env | model       |
    | pi      | E1  | gpt-4o-mini |
    | pi      | E2  | gpt-4o-mini |
    | agenta  | E1  | gpt-5.5     |
    | agenta  | E2  | gpt-5.5     |
```

### Code tools

```gherkin
Scenario Outline: the agent runs a code tool and uses its result
  Given an agent with harness <harness> on environment <env>
    And a code tool "secret_math" runtime python that returns input*7+1
    And agents_md "When asked to compute, call secret_math. Report only its number."
  When I send "Use secret_math on 6."
  Then a tool-call event for "secret_math" appears in the run
    And the reply contains "43"

  Examples:
    | harness | env |
    | pi      | E1  |
    | pi      | E2  |
    | pi      | E3  |
    | agenta  | E1  |
    | agenta  | E2  |
    | agenta  | E3  |
    | pi      | E4  |
    | agenta  | E4  |
```

```gherkin
Scenario: a code tool cannot see provider keys it did not declare
  Given a code tool "leak_probe" that prints os.environ.get("OPENAI_API_KEY","none")
  When the agent calls it
  Then the tool output is "none"
```

### Builtin tools

```gherkin
Scenario Outline: the agent runs a builtin shell tool
  Given an agent with harness <harness> on environment <env>
    And the builtin tool "bash" enabled (forced for agenta)
    And agents_md "When asked to echo, use bash to echo the exact text."
  When I send "echo the text MATRIX-OK using bash"
  Then a tool-call event for bash appears
    And the reply contains "MATRIX-OK"

  Examples:
    | harness | env |
    | pi      | E1  |
    | pi      | E2  |
    | agenta  | E1  |
    | agenta  | E2  |
    | agenta  | E3  |
```

### Gateway tools (Composio)

```gherkin
Scenario Outline: the agent calls a gateway tool over the callback
  Given a configured Composio connection for <integration>/<action>
    And an agent with harness <harness> on environment <env> and that gateway tool
    And agents_md "Use the available tool to answer; do not guess."
  When I send a prompt only that tool can answer
  Then a callback to /tools/call is made for the tool
    And the reply contains the tool's real result

  Examples:
    | harness | env | integration | action |
    | pi      | E2  | <tbd>       | <tbd>  |
    | agenta  | E2  | <tbd>       | <tbd>  |
# blocked:composio-connection until a real connection exists
```

### MCP (stdio)

```gherkin
Scenario Outline: the agent reads from a stdio MCP server
  Given AGENTA_AGENT_ENABLE_MCP=true
    And a stdio MCP server <server> exposing a tool with a known record
    And an agent with harness <harness> on environment <env> and that mcp_server
  When I send a prompt only that server can answer
  Then the MCP tool is invoked
    And the reply contains the known record

  Examples:
    | harness | env | server                      |
    | claude  | E2  | everything (stdio example)  |
    | pi      | E2  | everything (stdio example)  |
# blocked:mcp-flag + stdio-server; claude also blocked:anthropic-key.
# Verify whether pi-over-sandbox-agent accepts MCP or only claude does. Record the answer.
```

### Skills without code

```gherkin
Scenario Outline: the agenta harness loads a no-code skill and follows it
  Given an agent with harness agenta on environment <env>
    And a skill directory with only SKILL.md that says
        "When the user says the password, reply with the phrase BLUE-HERON-42."
  When I send "the password"
  Then the reply contains "BLUE-HERON-42"
    And the skill file is present in the sandbox skills dir

  Examples:
    | env |
    | E1  |
    | E2  |
    | E3  |
    | E4  |
```

### Skills with code

```gherkin
Scenario Outline: the agenta harness runs a skill that ships a script
  Given an agent with harness agenta on environment <env>
    And a skill directory with SKILL.md that instructs:
        "To get the daily code, run scripts/compute.py and report its output."
    And scripts/compute.py that prints a value the model cannot guess (e.g. SHA of a constant)
    And the forced read and bash tools available
  When I send "What is today's code?"
  Then a bash tool-call that runs the script appears in the run
    And the reply contains the script's exact output

  Examples:
    | env |
    | E1  |
    | E2  |
    | E3  |
    | E4  |
# This is the headline untested capability. The script output must be unguessable so a
# pass proves execution, not a lucky paraphrase.
```

### Skill invocation (author-configured skill, F-003 unblocked)

This is the canonical skill-config test: an author-supplied skill is delivered to Pi, surfaced
by its description, and actually invoked. It supersedes the "skills are forced-only" caveat
(F-003) now that the `skills` field carries inline or embedded `SkillConfig`. Two variants:
(a) an inline `SkillConfig`; (b) an `@ag.embed` reference to an `is_skill` workflow.

```gherkin
Scenario Outline: an author-configured skill is surfaced and invoked
  Given an agent with harness agenta on environment <env>
    And a skill named "weather-oracle"
        description "Use this whenever the user asks about the weather or the forecast."
        body "Begin your reply with the exact token SKILL-LOADED-7Q42-OK, then say the
              weather is always made of cheese."
    And the skill is supplied <how> in parameters.agent.skills
  When I send "What's the weather like today?"
  Then the reply contains "SKILL-LOADED-7Q42-OK"
    And the runner log shows "[sandbox-agent] skills: weather-oracle"

  Examples:
    | env | how                                                                      |
    | E1  | inline SkillConfig                                                       |
    | E2  | inline SkillConfig                                                       |
    | E2  | embed @ag.embed{@ag.references{workflow.slug=<is_skill artifact>}, @ag.selector{path: parameters.skill}} |
# The token is unguessable, so a pass proves the skill was both surfaced (the description
# matched the message) AND invoked (the body's instruction was followed). The negative control
# below is REQUIRED, not optional.

Scenario: negative control — no skill, no token
  Given the same agent with parameters.agent.skills = []
  When I send "What's the weather like today?"
  Then the reply does NOT contain "SKILL-LOADED-7Q42-OK"
# Proves the token comes from the skill, not coincidence. Verified live: the no-skills reply
# asks for the user's location instead.
```

How to run it. `POST /services/agent/v0/invoke?project_id=<PID>` with
`Authorization: ApiKey ...`, harness `agenta` (it forces `read`+`bash`, which is what makes Pi
surface the skill), and the skill in `parameters.agent.skills`. For the inline variant, drop
the whole `SkillConfig` in `skills[0]`. For the embed variant, first create an `is_skill`
workflow (`POST /api/simple/workflows/` with `flags.is_skill=true` and the `SkillConfig` at
`data.parameters.skill`), then reference it at the **artifact** level
(`@ag.references{workflow.slug}`), not `workflow_revision` with a bare slug (F-014). Saved
payloads: `req_test1_inline.json`, `req_test1_negctl.json`, `req_test2_artifact.json` in the
skills E2E evidence scratchpad.

### Client tools (via /messages)

```gherkin
Scenario: a client tool round-trips through the /messages browser callback
  Given an agent with a client tool "get_location"
    And a /messages session with a simulated client that answers the callback
  When the agent decides to call get_location
  Then the runner emits a client tool-call part on the stream
    And the simulated client posts a result back
    And the final assistant message uses that result
# Not testable on /invoke. Needs the /messages SSE path and a stub client.
```

### Pi system-prompt override (regression guard for F-001)

```gherkin
Scenario Outline: append_system reaches the model
  Given an agent with harness pi on environment <env>
    And harness_options.pi.append_system "Always end your reply with the token ZK-9."
  When I send "say hello"
  Then the reply ends with "ZK-9"

  Examples:
    | env | expected           |
    | E1  | pass               |
    | E2  | fail (F-001)       |
    | E3  | fail (F-001)       |
    | E4  | pass (in-process)  |
# E1/E4 pass today, E2/E3 fail. When F-001 is fixed, E2/E3 flip to pass and this becomes the
# regression test.
```

## What to capture per run

For every scenario run, save under `qa/runs/`:

- the exact `/run` request payload (or `/invoke` body),
- the runner response (JSON or NDJSON),
- the asserted token and whether evidence of the capability was present,
- the environment, harness, capability, commit, and date.

These captures are the seed for the replayable regression tests in phase 7.

## Live run results (2026-06-20)

Run against `localhost:8280`, project `Default` (`019e8df5-2a58-...`), model `gpt-4o-mini`,
via `qa/scripts/run_matrix.py`. Captures in `qa/runs/`.

| Capability / harness | E2 sandbox-agent local | E3 Daytona | Notes |
| --- | --- | --- | --- |
| chat+instructions+model / pi | pass | pass | |
| chat+instructions+model / agenta | pass | pass | |
| code tool python / pi | pass* | pass* | *after F-005 + F-006 fixes (extension rebuild + python3) |
| code tool python / agenta | pass* | pass* | *same |
| code tool node / pi | pass* | n/t | *after F-005 fix |
| builtin bash / pi | pass | pass | |
| builtin bash / agenta (forced) | pass | n/t | |
| skill no-code / agenta | pass | n/t | model follows SKILL.md directive when it reads the skill |
| skill with-code / agenta | infra-pass, contract-fail | n/t | script copies + runs; relative path unresolved (F-008) |
| append_system / pi | fail (F-001) | fail (F-001) | dropped on sandbox-agent by design (sandbox_agent.ts:875) |
| model override / pi | suspect-ignored (F-007) | n/t | ACP allows only `default` model |
| gateway (Composio) / pi | pass | n/t | github tool returned the real connected login `mmabrouk` (pi-agents project, `github-tvn` connection) |
| gateway (Composio) / agenta | pass | n/t | same, agenta harness |
| claude chat + code tool / claude | pass | n/t | model `haiku` (cheap); chat → `CLAUDE-HAIKU-OK`; python code tool over the MCP bridge → `QA-CODE-OK-43` |
| MCP (stdio) / claude | pass | n/t | flag on + credit; `get_secret_record` → `MCP-RECORD-X9F2` via `qa/scripts/mcp_qa_server.mjs` |
| model override / claude | aliases only (F-007) | | `haiku`/`sonnet[1m]`/`opus[1m]` accepted; a full id like `claude-haiku-4-5-…` silently falls back to default |

`n/t` = not tested (covered by an equivalent cell; skipped to save LLM spend and Daytona
spin-ups). The fixes were validated on both E2 and E3, so the n/t code-tool and skill cells
inherit the same runner behavior.

### E1 (direct in-process Pi) contrast run

Ran the direct in-process Pi contrast batch outside the deployed service path. Result:
**7/7 pass**, including `append_system_pi`, which fails on E2/E3. This is the
clean contrast that confirms F-001 is sandbox-agent-specific: in-process Pi honors `append_system`
(reply ended with the injected `ZK-9-END`), the ACP path drops it (`sandbox_agent.ts:875`). Code tools
also pass natively in-process (python3 is present in that path).

> This contrast batch ran Pi in-process directly, not through the SDK backend. The SDK's
> in-process backend (`InProcessPiBackend`, now renamed `LocalBackend`) is a stub today
> (`NotImplementedError`), so this exact contrast can no longer be driven from the SDK — only
> the `SandboxAgentBackend` SDK-direct path is live (F-018). Reproduce the contrast outside the
> SDK if you need it again.

| Capability / harness | E1 in-process Pi |
| --- | --- |
| chat / pi, agenta | pass |
| code tool python / pi, agenta | pass |
| builtin bash / pi, agenta | pass |
| append_system / pi | pass (vs fail on E2/E3) |

Pending: E4 (local SDK script) and the gated cells (Claude, MCP, gateway) once their
preconditions are met.

## Live run results — skill invocation (2026-06-24)

Run against `localhost:8280`, hotel-agent project (the API key's bound project), harness
`agenta`, skill `weather-oracle`, trigger `What's the weather like today?`, PASS = reply
contains `SKILL-LOADED-7Q42-OK`. This unblocks the F-003 "no author-facing skill config" gap:
the `skills` field now carries inline or embedded `SkillConfig`. Payloads in the skills E2E
evidence scratchpad (`req_test1_*.json`, `req_test2_*.json`).

| Variant / harness | E2 sandbox-agent local | E3 Daytona | Notes |
| --- | --- | --- | --- |
| inline skill / agenta | pass | n/t | reply began `SKILL-LOADED-7Q42-OK`; runner log `skills: weather-oracle` |
| inline skill negative control / agenta | pass | n/t | no skills → token absent (reply asks for location) |
| embed skill (`workflow.slug`) / agenta | pass | n/t | `is_skill` workflow resolves server-side → token present; artifact-level ref |
| embed skill (`workflow_revision.slug`) / agenta | fail (F-014) | n/t | bare slug, no version → HTTP 500 `EmbedNotFoundError`; hit the seeded default skill |
| skill materialization / agenta | n/a | pass | `skills: weather-oracle`, `sandbox=daytona`; skill uploaded into the Daytona sandbox |
| skill model run / agenta | n/a | blocked:daytona-model-auth | provider key not wired into the Daytona ACP daemon; pre-existing gap, not a skills bug |
| skill / claude | dropped (warns, F-015 resolved) | n/t | runner materializes skills for Pi only; Claude run also blocked:anthropic-key |

`n/t` = not tested. The Daytona model-auth blocker is the same pre-existing gap covered in
`provider-model-auth/` and `scratch/notes-model-auth.md` (no QA finding owns it; it is an
environment precondition, like `blocked:anthropic-key`, not a skills defect). Skill behavior is
correct up to that boundary: the skill materializes into the Daytona sandbox; only the model
turn cannot run. For Claude the drop is by design (the SDK path can't load `SKILL.md`); the
silent-drop observability gap is F-015.

## Live run results — SDK / API surface (2026-06-25)

Run against `localhost:8280` (compose project `agenta-ee-dev-wp-b2-rendering`, `services` →
`AGENTA_RUNNER_URL=http://sandbox-agent:8765`, so the service path is E2 sandbox-agent
local), commit `51e4c9e8e7`. The `examples/python/hotel_agent/draft/.env` API key
(`N1twS5YQ`) is bound to the **hotel-agent** project (`019e8df5-635d-…`, OpenAI key only) — NOT
the Default project, as the 2026-06-25 re-run corrected (see F-019). The `?project_id` on
`/invoke` routes the call but credential/connection resolution always reads the bound project's
vault. Model `openai/gpt-4o-mini`. Captures in
`qa/runs/E2__*.json`. **Wire-value change since the prior run:** the harness values are now
`pi_core` / `pi_agenta` / `claude` (the old `pi`/`agenta` return `not a valid HarnessType`),
and a bare `model: "gpt-4o-mini"` no longer resolves a key — the model must carry a provider
(`openai/gpt-4o-mini` or the structured `{provider, model}`) or no credential is injected
(F-017). `append_system`/`system` moved from `harness_options.pi.*` to
`harness_kwargs.pi_core.*` (both Pi-family harnesses read the `pi_core` slice).

| Cell (capability / harness) | E2 service /invoke | E4 SDK-direct | Triage | Notes |
| --- | --- | --- | --- | --- |
| chat+instructions / pi_core | pass | pass | — | `PONG`; E4 `E4-PONG` via `SandboxAgentBackend` over the local CLI |
| chat+instructions / pi_agenta | pass | n/t | — | `PONG` |
| instructions obeyed / pi_agenta | pass | n/t | — | agents_md forced reply `INSTR-OBEYED-88` |
| model override (structured ModelRef) / pi_core | pass | n/t | — | `{provider:openai, model:gpt-4o-mini}` → `STRUCT-OK`; key resolves |
| auth: Agenta-managed OpenAI / pi_core, pi_agenta | pass | pass | — | connection→key resolution injects the OpenAI key (provider-qualified model) |
| builtin bash / pi_core | pass | n/t | — | `QA-BASH-x86_64` (unguessable `uname -m`) |
| builtin bash (forced) / pi_agenta | pass | n/t | — | `QA-BASH-x86_64`; bash forced for the agenta harness |
| append_system / pi_core | pass | pass | — | `ZK-9-END` / `E4-ZK-9`; **F-001 fix confirmed live** on sandbox-agent |
| system (replace base prompt) / pi_core | pass | n/t | — | `SYS-REPLACED-77` |
| code tool (python) / pi_core, pi_agenta | **fail** | **fail** | escalate | `Code tools are not supported by the sidecar.` returned as a 200 tool result; by-design gate (F-016) |
| auth: Agenta-managed Anthropic / pi_core | blocked | n/t | env | 500 `model authentication failed`; **the QA key is bound to hotel-agent (only OpenAI), NOT Default** (F-019 re-run) |
| chat / claude | blocked | n/t | env | same: needs a Default- or pi-agents-scoped key; both have a real Anthropic vault key (F-019 re-run) |
| gateway tool (Composio) / pi_core, claude | blocked | n/t | env | 500 `Gateway tool resolution failed (HTTP 404)`; `github-w9g` is in Default, the hotel-agent key can't see it (F-019 re-run) |
| MCP (stdio) / claude | blocked | n/t | env | `AGENTA_AGENT_ENABLE_MCP=false` + Claude credential-blocked (F-019) |
| HITL approval round-trip (park→approve→resume) | blocked + SAME break as F-024 | n/t | env + architectural | `/invoke` is headless (no gate); `/messages` emits `tool-approval-request` but answers the gate inline with a `reject` → tool error, not a true suspend (F-019 re-run; characterized statically, feeds HITL design) |

`n/t` = not tested (equivalent cell already covered; E4 sampled chat + append_system to prove
the SDK-direct path, which uses the same wire and runner). The `/messages` SSE path was
verified working on Pi (Vercel `start`/`text-delta`/`finish`/`[DONE]` chunks) — the transport
the HITL round-trip rides — but the gate-raising harness (Claude) is unavailable.

**Green (proven end-to-end with an unguessable token):** chat, instructions, structured model
override, Agenta-managed OpenAI auth (connection→key injection), builtin bash (real `uname -m`),
`append_system` (F-001 regression now green on sandbox-agent), `system` replace, and the
`/messages` SSE transport — on both `pi_core` and `pi_agenta`, on E2 and (sampled) E4.

**New findings this pass:** F-016 (code-tool sidecar gate, escalate), F-017 (bare model string
→ no credential, defer), F-018 (E4 `LocalBackend` is a stub; SDK-direct works via
`SandboxAgentBackend`, fix-now doc), F-019 (Claude/Anthropic/gateway/MCP/HITL all blocked on
per-project credential access, environmental).

## Live run results — SDK / API surface re-run (2026-06-25, second pass)

Run against `localhost:8280` via the box IP (`http://144.76.237.122:8280`), compose project
`agenta-ee-dev-wp-b2-rendering`, commit `2389401ac3` (the `f8cfee3908` sidecar-uri commit on top).
E2 sandbox-agent local. Key: the hotel-agent `.env` API key (OpenAI-only vault, project
`019e8df5-635d-…`). Model `openai/gpt-4o-mini` (cheap). Both entrypoints exercised. Captures:
`runs/E2_2026-06-25__*`.

**Wire-contract changes since the prior pass:** (1) the `sandbox` per-run field is GONE — the
sidecar provider (local/daytona) is configured by the sidecar's OWN env; an optional `uri` routes
to a sidecar, allowlist-gated by `AGENTA_RUNNER_URI_ALLOWLIST` (default empty = off; E2 just
uses the env-var `AGENTA_RUNNER_URL` fallback). (2) the `code` tool wire field is `script`
(+`input_schema`), NOT `code`/`parameters` — the old shape 500s at config validation. (3) http MCP
is now ENABLED and stdio DISABLED-fail-loud — but ONLY on the Claude branch (F-032).

| Cell (capability / harness) | /invoke (batch) | /messages (SSE) | Triage | Notes |
| --- | --- | --- | --- | --- |
| chat+instructions / pi_core | pass | pass | — | `PONG`; SSE emits start/text-delta(P,ONG)/finish/[DONE] + `sessionId` |
| chat+instructions / pi_agenta | pass | n/t | — | `PONG` |
| instructions obeyed / pi_agenta | pass | pass | — | `INSTR-OBEYED-7K2Q` / `MSG-INSTR-5T8` |
| model override (structured ModelRef) / pi_core | pass | n/t | — | `{provider:openai, model:gpt-4o-mini}` → `STRUCT-OK-9X4` |
| model resolution matches config | pass | pass | — | LLM span `gen_ai.system=openai`, `request.model=gpt-4o-mini`; cost confirms (F-031) |
| append_system / pi_core | pass | n/t | — | `ZK-9-END3`; F-001 stays green; the text is echoed in the trace |
| system (replace) / pi_core | pass | n/t | — | `SYS-REPLACED-77Q` |
| builtin bash / pi_core, pi_agenta | pass | pass | — | `QA-BASH-x86_64` (real `uname -m`); SSE shows tool-input/tool-output parts |
| code tool (python) / pi_core | **fail-loud 500** | **error part** | verify+docs | `Code tools are not supported by the sidecar.` — NO LONGER a silent 200 (F-027, F-016 improved) |
| bare model string (no provider) / pi_core | fail-loud 500 | n/t | — | `needs a provider prefix` — F-017 resolved, confirmed |
| skills (inline author SkillConfig) / pi_agenta | pass | n/t | — | `SKILL-LOADED-7Q42-OK`; runner log `skills: weather-oracle` |
| skills (inline author SkillConfig) / **pi_core** | **pass** | n/t | matrix-fix | token present on PLAIN pi_core — matrix rule 4 says n/a (F-028) |
| skills negative control / pi_agenta | pass | n/t | — | no skills → no token |
| skills with code (bundled script) / pi_agenta | **fail** | n/t | open | script materializes but model can't resolve `scripts/code.py` relative path (F-008 still live) |
| right-provider-on-error / pi_core, claude | pass | pass | — | `pi_core:`/`claude: model authentication failed — … Anthropic key` (F-031) |
| Agenta-managed Anthropic / pi_core, claude | blocked (env) | blocked | env | hotel-agent vault has no Anthropic key (F-019); resolution wiring correct |
| gateway tool (Composio) / pi_core | blocked (500) | n/t | env | `Gateway tool resolution failed (HTTP 404)` — github-tvn is pi-agents', not hotel-agent (F-019) |
| user MCP (stdio) / pi_core | **silent-drop 200** | n/t | defer | dropped with no log, no error on the Pi family (F-032); stdio-fail-loud is Claude-only |
| user MCP (http) / pi_core | **silent-drop 200** | n/t | defer | same; http-MCP-enabled is Claude-only and credential-blocked (F-032, F-019) |
| internal gateway-tool MCP / claude | blocked (env) | n/t | env | Claude credential-blocked; on Pi gateway rides the Pi extension, not MCP |
| HITL approval / claude | blocked (env) | n/t | env | Claude credential-blocked; `/invoke` headless anyway (F-019) |

**/invoke vs /messages — they agree.** Both entrypoints return the same assistant content for the
same cell. `/messages` default (Accept: application/json) returns the SAME batch JSON as `/invoke`
PLUS a `session_id`. `/messages` with `Accept: text/event-stream` returns the true AI SDK v6 Vercel
UI Message Stream: `start`(+sessionId)→`start-step`→`text-start`→`text-delta`…→`text-end`→
`finish-step`→`finish`(usage+traceId)→`[DONE]`, with tool runs adding
`tool-input-start`/`tool-input-available`/`tool-output-available` parts. Errors differ correctly by
contract: `/invoke` returns HTTP 500 with the message in the envelope; `/messages` SSE returns HTTP
200 with an `error` stream part (`errorText: "Agent run failed: <same message>"`) then `[DONE]`.

**TRACING (verified via `GET /api/preview/tracing/traces/{trace_id}`).** Traces ARE generated for
every run and carry a rich nested tree: `_agent` (workflow) → `invoke_agent` (AGENT) → `turn N`
(CHAIN) → `chat <model>` (LLM) + `execute_tool <name>` (TOOL). The runner's separate OTLP batch
lands under the workflow trace via traceparent. **Present:** provider+model on the LLM span
(`gen_ai.system=openai`, `request.model`/`response.model=gpt-4o-mini`, `response.id`,
`finish_reasons`); the full config echo on `_agent` (`agent.model`, `agent.harness`,
`harness_kwargs.pi_core.append_system` TEXT, `agent.tools`, `agent.skills` config); per-tool spans
(`gen_ai.tool.name=bash`, `tool.call.id`); token+cost roll-up at every level (incl.
`cache_read_input_tokens`). **Missing (findings):** (a) no skill-USED/loaded signal and no
forced/platform `_agenta` skills in the trace — only the author skill CONFIG echo (F-029); (b)
error runs carry only `ag.metrics.errors.cumulative=1` with NO message/provider/exception event and
NO nested spans — the diagnostic text lives only in the HTTP body / SSE error part (F-030).

**New findings this pass:** F-027 (code tools now fail-loud, F-016 silent-200 fixed), F-028
(author skills load on plain pi_core; matrix rule 4 wrong), F-029 (skills invisible in traces
beyond config echo), F-030 (error runs trace only a count, no message), F-031 (right-provider +
model-resolution confirmed; Claude alias now needs a provider prefix as an F-017 side-effect),
F-032 (Pi-family user MCP dropped silently, no log/error). Still blocked on credentials (F-019):
Agenta-managed Anthropic/Claude, Composio gateway, http-MCP-on-Claude, stdio-fail-loud-on-Claude,
HITL — all need a Default/pi-agents-scoped API key (not minted this read-only pass). Self-managed
Anthropic stays untested by design: it has no per-request channel (must be baked into the sidecar
env), and this pass did not bake the user-provided raw key — limitation documented, not forced.

---

## Model-authentication axis

A fourth axis, orthogonal to environment, harness, and capability. It tests that the right
credential reaches the right harness — no more, no less — and that the model that ran is the
one that was asked for.

**Use cheap models for all model-auth QA.** Use `gpt-4o-mini` or `o4-mini` for the Pi/OpenAI
cells and `claude-haiku-4-5-20251001` (or the alias `haiku`) for the Claude/Anthropic cells.
Never use GPT-4o, Sonnet, or Opus for routine QA runs.

### Terminology

- **Agenta-managed** (`connection.mode = agenta`): the credential lives in the project vault;
  Agenta resolves it and injects it. The user stores the key once; the agent config references
  it by slug or takes the project default.
- **Self-managed** (`connection.mode = self_managed`): Agenta injects nothing. The harness
  uses its own OAuth login, a baked env key in the sidecar, or a key the user supplies out of
  band. The QA runner will have no explicit key; whether the run still succeeds tells you which
  ambient credential was used.
- **Provider**: the logical credential family — `openai`, `anthropic`, or a custom-provider
  slug stored in the vault as a `custom_provider` secret (a custom base-URL endpoint).
- **Deployment variant**: direct (the provider's public endpoint), or a cloud wrapper — Bedrock,
  Vertex, or a custom endpoint. For v1, Bedrock and Vertex on Claude and on Pi are declared
  but not wired (fail-loud); custom endpoint (Pi only) is staged with the model-config sibling.
  The QA cells for those variants are therefore `blocked:not-wired-v1` and exist only to
  confirm the fail-loud behavior.

### Validity rules

1. **Pi reaches OpenAI and Anthropic (and six other providers) via direct api-key.** The full
   vault-mapped Pi provider list is in `harness-provider-matrix.md`. For auth QA, OpenAI and
   Anthropic are the representative pair; a custom-provider test covers the base-URL path.
2. **Claude reaches Anthropic only**, three ways: direct key, custom gateway (ANTHROPIC_BASE_URL),
   or Bedrock/Vertex (v1: declared, not wired — fail-loud). No OpenAI cell is valid for Claude.
3. **Self-managed cells require an ambient credential.** In the QA environment these require a
   baked-in sidecar env key or an OAuth login. If neither is present, the cell is
   `blocked:no-ambient-cred`.
4. **In-process Pi (E1) does not run Claude** (rule 1 from the main validity rules). Every
   Claude auth cell on E1 is `n/a`.
5. **Custom provider on Claude is only via `ANTHROPIC_BASE_URL`** (a custom Anthropic-protocol
   gateway). A custom OpenAI-protocol endpoint on Claude is `n/a`.
6. **Bedrock/Vertex are not wired in v1.** Cells exist to assert fail-loud (HTTP 422
   `UnsupportedDeployment`), not to run a model turn.
7. **E3 (Daytona) inherits from E2** for auth: if the key is not wired into the Daytona ACP
   daemon, the run fails regardless of what the vault holds. Flag as
   `blocked:daytona-model-auth` rather than `blocked:key-missing`.

### Model-auth validity matrix

Rows = provider + auth mode + deployment. Columns = harness (pi, agenta, claude) at the
representative environments E2 (and E1 where relevant).

| Provider / mode / deployment | pi (E2) | agenta (E2) | claude (E2) |
| --- | --- | --- | --- |
| OpenAI — Agenta-managed — direct | valid | valid | n/a (Claude is Anthropic-only) |
| OpenAI — self-managed — direct | valid (if ambient key) | valid (if ambient key) | n/a |
| Anthropic — Agenta-managed — direct | valid | valid | valid |
| Anthropic — self-managed — direct | valid (if ambient key) | valid (if ambient key) | valid (if ambient cred) |
| Custom provider (OpenAI-compat endpoint) — Agenta-managed | blocked:not-wired-v1 (Pi custom-endpoint stages with model-config) | blocked:not-wired-v1 | n/a |
| Custom provider (Anthropic-compat gateway) — Agenta-managed | n/a | n/a | valid (ANTHROPIC_BASE_URL) |
| Anthropic — Agenta-managed — Bedrock | blocked:not-wired-v1 (fail-loud expected) | blocked:not-wired-v1 | blocked:not-wired-v1 |
| Anthropic — Agenta-managed — Vertex | blocked:not-wired-v1 (fail-loud expected) | blocked:not-wired-v1 | blocked:not-wired-v1 |

Notes on blocked cells:
- `blocked:not-wired-v1` cells should still be run — the expected result is a fail-loud HTTP
  422 `UnsupportedDeployment`. If they return 200, that is a finding (a silently-mis-credentialed
  run is worse than an error).
- Pi custom-endpoint/cloud consumption stages with the `model-config` sibling project as a
  prerequisite. Until that lands, Pi cells for custom endpoint and cloud deployments remain
  blocked.

### Credential-isolation sub-scenarios (run in parallel with the scenarios above)

These exist to catch the whole-vault dump (current-code risk R1 from `notes-model-auth.md`):
once the redesign lands, each run should have access to exactly one provider's key.

| Sub-scenario | Expected behavior | How to verify |
| --- | --- | --- |
| Project has OpenAI key only; run targets OpenAI model | pass | reply arrives; trace shows `openai` provider |
| Project has OpenAI key only; run targets Anthropic model | fail-loud: no Anthropic key | HTTP 4xx or runner error before model turn |
| Project has both OpenAI and Anthropic keys; run targets OpenAI model | pass; Anthropic key NOT injected | `ANTHROPIC_API_KEY` absent from sandbox env (verify via a code tool `leak_probe` that prints `os.environ.get("ANTHROPIC_API_KEY","none")`) |
| Project has both OpenAI and Anthropic keys; run targets Anthropic model | pass; OpenAI key NOT injected | `OPENAI_API_KEY` absent via `leak_probe` |
| Self-managed; project vault is empty | pass (harness uses own ambient cred) OR blocked:no-ambient-cred | no vault error; observe which cred ran (trace provider label) |

**Current behavior caveat.** The whole-vault dump (risk R1) is the current code's posture:
all provider keys for the project are injected into every run regardless of model. The
isolation sub-scenarios will FAIL on the current code for the "key NOT injected" assertions.
These sub-scenarios become meaningful regression tests only after the `provider-model-auth`
redesign lands. Until then, run them to document the current state and capture the baseline
captures in `qa/runs/`.

### Model-auth scenario: Agenta-managed OpenAI (gpt-4o-mini), harness pi

```gherkin
Scenario Outline: pi harness uses a vault-managed OpenAI key
  Given a project with exactly one provider_key secret for openai (e.g. slug "openai-qa")
    And no other provider keys in the vault
    And an agent with harness pi, model "gpt-4o-mini", connection {mode: agenta}
    And agents_md "Reply with exactly the word PONG and nothing else."
  When I POST /invoke on environment <env>
  Then the reply is exactly "PONG"
    And the trace span carries provider "openai" and model "gpt-4o-mini"
    And no Anthropic or other-provider key appears in the sandbox env (leak_probe)

  Examples:
    | env |
    | E1  |
    | E2  |
```

### Model-auth scenario: Agenta-managed Anthropic (claude-haiku), harness pi

```gherkin
Scenario Outline: pi harness uses a vault-managed Anthropic key
  Given a project with exactly one provider_key secret for anthropic
    And an agent with harness pi, model "claude-haiku-4-5-20251001",
        connection {mode: agenta}
    And agents_md "Reply with exactly the word PONG and nothing else."
  When I POST /invoke on environment <env>
  Then the reply is exactly "PONG"
    And the trace span carries provider "anthropic"
    And no OpenAI or other-provider key appears in the sandbox env (leak_probe)

  Examples:
    | env |
    | E2  |
# E1 (in-process Pi) is also valid for Anthropic via Pi, but the whole-vault dump means
# cross-key isolation cannot be asserted there today.
```

### Model-auth scenario: Agenta-managed Anthropic (claude-haiku), harness claude

```gherkin
Scenario Outline: claude harness uses a vault-managed Anthropic key
  Given a project with a provider_key secret for anthropic (the pi-agents project has one)
    And an agent with harness claude, model "haiku" (alias accepted by applyModel),
        connection {mode: agenta}
    And agents_md "Reply with exactly the word PONG and nothing else."
  When I POST /invoke on environment <env>
  Then the reply is exactly "PONG"
    And the trace span carries provider "anthropic"
    And the runner log does not contain "model authentication failed"

  Examples:
    | env |
    | E2  |
# Use the pi-agents project's own API key. Cross-project keys silently resolve the wrong
# vault (finding F-004 lesson). Alias "haiku" is required; a full id like
# "claude-haiku-4-5-20251001" falls back to default (Sonnet) and burns credit (F-007).
```

### Model-auth scenario: Custom provider (OpenAI-compatible endpoint), harness pi

```gherkin
Scenario: pi harness routes through a custom OpenAI-compat base URL
  Given a custom_provider vault secret with a base_url pointing to an OpenAI-compat endpoint
    And an agent with harness pi, model "<provider-slug>/gpt-4o-mini",
        connection {mode: agenta, slug: "<provider-slug>"}
  When I POST /invoke on environment E2
  Then the run returns HTTP 422 with code "UnsupportedDeployment"
    (because Pi custom-endpoint consumption is blocked:not-wired-v1)
# When the model-config sibling lands, this cell flips to valid and the expected result
# becomes "reply arrives with a model turn using the custom endpoint."
# Verify then by checking the outbound request host in the sandbox (network intercept or
# provider-side log) matches the custom base_url, not api.openai.com.
```

### Model-auth scenario: Custom Anthropic gateway, harness claude

```gherkin
Scenario: claude harness routes through a custom Anthropic base URL
  Given a custom_provider vault secret for anthropic with base_url set to a proxy endpoint
    And the proxy echoes requests and returns a valid Claude response
    And an agent with harness claude, model "haiku",
        connection {mode: agenta, slug: "<custom-anthropic-slug>"}
  When I POST /invoke on environment E2
  Then the reply arrives (via the proxy)
    And the proxy log shows an inbound request from the runner
    And ANTHROPIC_BASE_URL in the sandbox env equals the custom base_url
# This is the ANTHROPIC_BASE_URL path. The custom_provider secret's base_url is projected
# into ANTHROPIC_BASE_URL by the harness adapter. Verify isolation: ANTHROPIC_API_KEY should
# be the proxy's key, not the direct anthropic key from the vault.
```

### Model-auth scenario: Bedrock / Vertex fail-loud (v1 blocked)

```gherkin
Scenario Outline: a cloud deployment variant is rejected before the model turn
  Given an agent with harness <harness>, model <model>,
        connection {mode: agenta, deployment: <deployment>}
  When I POST /invoke on environment E2
  Then the response is HTTP 422 with code "UnsupportedDeployment"
    And no model turn runs (no LLM call, zero spend)

  Examples:
    | harness | model               | deployment |
    | claude  | haiku               | bedrock    |
    | claude  | haiku               | vertex     |
    | pi      | claude-haiku-..     | bedrock    |
    | pi      | claude-haiku-..     | vertex     |
# These are the fail-loud guards. A 200 here is a finding (mis-credentialed silent run).
# When v1 wiring lands, remove these rows and replace with real cloud-cred tests.
```

### Model-auth scenario: self-managed, no vault key injected

```gherkin
Scenario Outline: self-managed connection injects nothing from the vault
  Given an agent with harness <harness>, model <model>,
        connection {mode: self_managed}
  When I POST /invoke on environment E2
  Then the vault resolve step is skipped (no HTTP call to /vault/connections/resolve in logs)
    And either: the run succeeds using the harness's own ambient credential
        or: the run fails fast with "no credential available" (not a vault error)
    And no provider key from the project vault appears in the sandbox env (leak_probe)

  Examples:
    | harness | model       |
    | pi      | gpt-4o-mini |
    | claude  | haiku       |
# If the sidecar has no baked ambient key and no OAuth login, both cells are
# blocked:no-ambient-cred. Run them anyway; the expected result changes from "success" to
# "clean no-cred error." Either outcome is acceptable; a vault-key leak is not.
```

### How to set up and verify model-auth runs

**Playground setup (per-request override, fastest for E2):**

```bash
KEY=<pi-agents-project-API-key>
PROJ=<pi-agents-project-id>
curl -s -X POST \
  -H "Authorization: ApiKey $KEY" -H "content-type: application/json" \
  "http://localhost:8280/services/agent/v0/invoke?project_id=$PROJ" \
  -d '{
    "data": {
      "inputs": {"messages": [{"role": "user", "content": "ping"}]},
      "parameters": {
        "agent": {
          "harness": "claude",
          "model": "haiku",
          "agents_md": "Reply with exactly the word PONG and nothing else.",
          "connection": {"mode": "agenta"}
        }
      }
    }
  }'
```

**Verifying the right credential ran:**

1. Check the trace span: `span.attributes["ag.model.provider"]` must match the intended provider.
2. Check the runner logs for `"model authentication failed"` (absence is required on a pass).
3. For isolation: add a `leak_probe` code tool (python, `print(os.environ.get("ANTHROPIC_API_KEY","none"))`)
   and confirm the output is `"none"` when running an OpenAI model, and vice versa. Note that
   on current code (pre-redesign) this probe WILL print the key — capture that as baseline.
4. For self-managed: check runner logs for the vault-resolve HTTP call; it must be absent on a
   `self_managed` run.
5. For fail-loud cells: the HTTP status must be 422 with a structured error body containing
   `"UnsupportedDeployment"` and no inference spend.

**Which project to use:**

Use the `pi-agents` project for all Anthropic/Claude cells — it has the Anthropic provider
key. Use a separate QA project for the OpenAI isolation test to avoid vault-key cross-contamination.
Always use that project's own API key (F-004 lesson: a cross-project API key silently resolves
the wrong vault).

**Model aliases for Claude:**

Use alias `haiku` (not the full id `claude-haiku-4-5-20251001`) until F-007 is fixed. A full
id falls back silently to the default model (Sonnet), which is expensive.

**Cost guard:**

- OpenAI cells: `gpt-4o-mini`. Do NOT use `gpt-4o`, `gpt-5.5`, or any Sonnet-tier model.
- Anthropic cells: `haiku` alias or `claude-haiku-4-5-20251001` once F-007 is fixed.
- Fail-loud cells (blocked:not-wired-v1): no model turn runs; zero spend. Still send them.
- Daytona (E3): E3 inherits E2 for auth; unless specifically testing Daytona-specific model-auth
  wiring, skip E3 auth cells to save Daytona spin-up cost and re-run time.

### Live run results — model-auth (not yet run)

This section will be filled in when the first model-auth pass runs. Expected cells to complete
on current code (pre-redesign):

| Cell | Expected on current code | Status |
| --- | --- | --- |
| OpenAI Agenta-managed / pi / E2 | pass (whole-vault dump delivers the key) | not yet run |
| Anthropic Agenta-managed / pi / E2 | pass (same) | not yet run |
| Anthropic Agenta-managed / claude / E2 | pass (F-004 corrected; pi-agents project key required) | not yet run |
| Custom gateway / claude / E2 | not yet run | not yet run |
| Bedrock fail-loud / claude / E2 | expect 422 | not yet run |
| Vertex fail-loud / claude / E2 | expect 422 | not yet run |
| Self-managed / pi / E2 | depends on ambient cred | not yet run |
| Isolation: two keys, OpenAI model / pi / E2 | FAIL on current code (Anthropic key leaks) | not yet run; baseline capture |
| Isolation: two keys, Anthropic model / pi / E2 | FAIL on current code (OpenAI key leaks) | not yet run; baseline capture |
