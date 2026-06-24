# Agent-workflows QA matrix and scenarios

The product of environment, harness, and capability. The first half is the coverage matrix
that says which cells are real. The second half is the Gherkin scenarios that say how to run
each one and what a pass looks like. See `README.md` for how to configure and run each axis.

## Legend

Environments: `E1` service / in-process Pi, `E2` service / sandbox-agent local, `E3` service / sandbox-agent
Daytona, `E4` local SDK backend.

Harnesses: `pi`, `agenta`, `claude`.

Cell codes:

- `valid` the cell exists and should be tested.
- `n/a` the cell cannot exist (the harness or backend does not support it).
- `blocked:<reason>` the cell is valid but cannot run until a precondition is met.
- `pass` / `fail` filled in as runs happen, with a link to the run capture or finding.

## Validity rules (why cells are n/a or blocked)

These come from the code and the prior `feature-matrix-test.md` run. They are the reason
the full product is much smaller than it looks.

1. **In-process Pi does not support Claude.** `InProcessPiBackend.supported_harnesses` is
   `{pi, agenta}`. So every `claude` cell on E1 is `n/a`. Claude only runs on sandbox-agent (E2, E3)
   or on E4 when the script uses `SandboxAgentBackend`.
2. **Claude is blocked on an Anthropic key.** The harness is wired but returns HTTP 500
   `claude: model authentication failed` with no Anthropic key in the project vault. Every
   `claude` cell is `blocked:anthropic-key` until a key is added.
3. **Builtin tools are a Pi concept.** `pi` and `agenta` deliver Pi builtins (`bash`,
   `read`, `write`, `edit`). Claude has no Pi builtins; it gets tools over MCP only. So
   builtin-tool cells on `claude` are `n/a`.
4. **Skills are an Agenta-harness feature.** The SDK only wires the `skills` field for
   `AgentaAgentConfig`. A plain `pi` run does not load skills, and Claude has no skill
   concept here. So skill cells are `valid` on `agenta` and `n/a` on `pi` and `claude`.
   Confirm this during the run: if a plain `pi` run can be made to load a skill, that is a
   finding, not an assumption. As of 2026-06-24 the `skills` field carries an author-supplied
   `SkillConfig` (inline or `@ag.embed`), so F-003 is unblocked: skills are no longer
   forced-only. On Claude the runner drops them by design (it materializes skills for Pi only;
   the silent-drop observability gap is F-015).
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
| skills without code | n/a | valid (forced) | n/a |
| skills with code | n/a | valid | n/a |
| skill invocation (author config) | n/a | valid (inline + embed) | dropped by design (silent until F-015) |
| client tools | n/a on /invoke | n/a on /invoke | n/a on /invoke |

### Valid cell x environment (where each valid capability should run)

| Capability / harness | E1 in-proc Pi | E2 sandbox-agent local | E3 sandbox-agent Daytona | E4 local SDK |
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
| skill / claude | dropped (silent, F-015) | n/t | runner materializes skills for Pi only; Claude run also blocked:anthropic-key |

`n/t` = not tested. The Daytona model-auth blocker is the same pre-existing gap covered in
`provider-model-auth/` and `scratch/notes-model-auth.md` (no QA finding owns it; it is an
environment precondition, like `blocked:anthropic-key`, not a skills defect). Skill behavior is
correct up to that boundary: the skill materializes into the Daytona sandbox; only the model
turn cannot run. For Claude the drop is by design (the SDK path can't load `SKILL.md`); the
silent-drop observability gap is F-015.
