# Final AI QA sweep — checklist

This checklist drives one autonomous end-to-end QA pass over the agent-workflows feature.
Every row is self-contained: it states the configuration, the action, the expected result,
and the verification token that proves the capability actually ran rather than appearing to
run.

Surface labels: **FE** = playground UI, **API** = curl / `/invoke` or `/messages`.
Model constraint: use cheap models only — `gpt-4o-mini` (Pi / pi_core) and
`claude-haiku-3-5` (Claude). Do not call `gpt-4o`, `claude-opus`, or any large model.

Token convention: each row carries an unguessable token (8-character hex). The agent must
emit that exact string in its reply for the cell to count as a pass. Instruct the agent with
a phrase like "include the code XXXXXXXX verbatim in your reply" alongside the real task
question.

---

## Axis 1 — Permissions (all three layers)

The permission system has three layers:
1. **Harness settings.json** — the per-tool allow/deny list baked into the harness config
   that the TS runner reads.
2. **sandbox_permission** — the `permission_policy` field in the agent config, applied
   server-side before the runner starts.
3. **Sidecar tool-permission / HITL** — the sidecar's per-tool gate, including
   human-in-the-loop approval for designated tools.

Each layer must be tested independently: verifying the end result without isolating the
layer that enforced it is not sufficient.

| # | Layer | Configure | Action | Expected result | Verify token |
|---|-------|-----------|--------|-----------------|--------------|
| P-01 | Harness settings.json | Set `harness_options.settings` to deny the `bash` tool. Use harness `agenta`, `gpt-4o-mini`. | Ask the agent to run `echo hello` via bash. | The agent cannot execute bash; it reports a refusal or a tool-not-available error. The bash tool call does NOT appear in the trace. | `a3f1bc72` |
| P-02 | Harness settings.json | Set `harness_options.settings` to allow only the `read` tool. Use harness `agenta`, `gpt-4o-mini`. | Ask the agent to write a file, then to read a file. | Write is refused; read succeeds. Two tool events visible in trace, only one succeeds. | `9d4e2a05` |
| P-03 | sandbox_permission | Set `permission_policy.bash` to `DENY` in the agent config. Use harness `agenta`, `gpt-4o-mini`. | Ask the agent to run `date` via bash. | Bash call is blocked server-side. Error or refusal in reply. | `7c8b3f11` |
| P-04 | sandbox_permission | Set `permission_policy.bash` to `ALLOW` and `permission_policy.write` to `DENY`. Use harness `agenta`, `gpt-4o-mini`. | Ask the agent to run `echo ok` (bash) then write a file. | Bash succeeds; write is blocked. Verify by checking runner logs or tool events in trace. | `e2d94a6c` |
| P-05 | Sidecar tool-permission (non-HITL deny) | Configure the sidecar to deny the `write` tool at the tool-permission layer. Use harness `claude`, `claude-haiku-3-5`. | Ask Claude to write a file. | Write is blocked by the sidecar gate, not the harness settings. Error visible in trace under the sidecar span. | `b56f0318` |
| P-06 | HITL approve → resume | Configure one tool (e.g. `bash`) as HITL-gated in the sidecar. Use harness `claude`, `claude-haiku-3-5`. Open the playground (FE). | Ask Claude to run a bash command. Approve the HITL prompt in the playground. | Execution pauses at the HITL gate; the FE shows an approval UI; after approval the tool executes and the reply is delivered. Trace shows the HITL pause and resume. | `4d7e91ab` |
| P-07 | HITL deny | Same HITL setup as P-06. | Ask Claude to run a bash command. Deny the HITL prompt in the playground. | Tool call is cancelled; Claude receives a denial and adjusts its reply accordingly. Trace shows the HITL deny event. | `f3c82d57` |
| P-08 | pi_core no ask gate | Use harness `pi` (pi_core). Configure a tool as HITL-gated. | Ask the agent to use that tool. | pi_core does not support HITL gating; the tool runs without pause or is not available. No HITL event in trace. Document whether it silently skips the gate or errors. | `02a6e4b9` |

---

## Axis 2 — MCP

MCP is flag-gated (`AGENTA_AGENT_ENABLE_MCP=true`). All MCP cells require that flag set.
Claude is the primary MCP harness (Pi drops MCP tools with a warning log per F-015).

| # | Flavor | Configure | Action | Expected result | Verify token |
|---|--------|-----------|--------|-----------------|--------------|
| M-01 | HTTP (remote) MCP | Set `AGENTA_AGENT_ENABLE_MCP=true`. Add a remote HTTP MCP server URL to `mcp_servers` in the agent config. Use harness `claude`, `claude-haiku-3-5`. | Ask the agent to call a tool that only the remote MCP server exposes. | The tool call reaches the remote server and returns a result. The reply contains data only the MCP server could supply. | `6a1f5c84` |
| M-02 | HTTP MCP — error | Same setup as M-01 but point the MCP server URL at an unreachable host. | Ask the agent to use the MCP tool. | Connection error is surfaced. Trace contains an MCP error span with the server URL and error type. Reply mentions a tool failure. | `91d3b047` |
| M-03 | Internal gateway-tool MCP channel (Claude) | Confirm the gateway-tool MCP channel is active for Claude. Use harness `claude`, `claude-haiku-3-5`, a Composio-backed gateway tool. | Ask the agent to call the gateway tool (e.g. fetch a GitHub issue). | The gateway tool is delivered over the internal MCP channel; the result is in the reply. Trace shows the MCP channel tool call. | `3e72c1a8` |
| M-04 | Stdio MCP — refused | Attempt to configure a stdio MCP server in the agent config. Use any harness. | Submit the config via API or playground. | The platform refuses or ignores stdio MCP server entries. No stdio process is spawned. Log confirms the refusal. | `d5890f26` |

---

## Axis 3 — Skills

Skills are an `agenta` harness feature. A skill must be USED (called, not just configured)
for the cell to pass. "Used" means the skill appears in both the skills-linked field AND
the skills-used field on the trace.

Agenta builtin skills are hard-coded in `agenta_builtins.py` and loaded automatically for
the `agenta` harness. They must appear in the trace without explicit user configuration.

| # | Skill type | Configure | Action | Expected result | Verify token |
|---|-----------|-----------|--------|-----------------|--------------|
| S-01 | Author-supplied skill (inline) | Add an inline `SkillConfig` to the agent config for harness `agenta`, `gpt-4o-mini`. The skill should do something the base model cannot (e.g. return a specific computed value). | Ask a question that requires the skill to answer. | The skill is invoked; the reply contains data only the skill could produce. | `72b5e039` |
| S-02 | Author-supplied skill (`@ag.embed`) | Embed the skill via `@ag.embed` reference. Same harness / model. | Same question pattern as S-01. | Same result. The embed path behaves identically to inline. | `c4d61f80` |
| S-03 | Skills linked in trace | Any skill run (S-01 or S-02). | After the run, inspect the trace in the UI or via the tracing API. | The trace node for the run shows the skill in the `skills_linked` field (skills configured). | `0f3a9d52` |
| S-04 | Skills used in trace | Same run as S-03. | Inspect the same trace. | The trace node shows the skill in the `skills_used` field (skills actually called). A skill that is linked but not used is a finding, not a pass. | `8b4e27c6` |
| S-05 | Agenta builtin skills present | Use harness `agenta`, `gpt-4o-mini`. Do NOT add any author skills to the config. | Ask a question that the Agenta builtin skills answer (e.g. a question about the agent's own capabilities as defined in `AGENTS.md`). | The reply is informed by the builtin. The builtin skill appears in `skills_linked` and `skills_used` on the trace without user configuration. | `a91d4f63` |
| S-06 | Skills not delivered to Claude | Use harness `claude`, `claude-haiku-3-5`. Add a skill to the agent config. | Send any message. | The runner drops the skills with a warning log (F-015). No skill is delivered or called. The trace does NOT show skills_used. | `5e28b0c7` |

---

## Axis 4 — Model selection

The model picker is harness-filtered: only models the active harness supports should appear.
"Ask the harness which model are you" means prompting the agent to report its own model
identity in a way that can be verified against the config.

| # | Scenario | Configure | Action | Expected result | Verify token |
|---|----------|-----------|--------|-----------------|--------------|
| Mo-01 | Correct model runs for Pi | Set `model` to `gpt-4o-mini` with provider `openai`, harness `pi`. | Ask "What model are you? Include the code 1b7f3e94 in your reply." | The reply identifies `gpt-4o-mini`. Trace `model` field matches config. | `1b7f3e94` |
| Mo-02 | Correct model runs for Claude | Set `model` to `claude-haiku-3-5` with provider `anthropic`, harness `claude`. | Ask "What model are you? Include the code 8c2d5a71 in your reply." | The reply identifies haiku. Trace `model` field matches config. | `8c2d5a71` |
| Mo-03 | Picker is harness-filtered (FE) | In the playground, switch the harness to `pi`. | Open the model picker dropdown. | Only Pi-compatible models appear. Claude models are absent. Surface: **FE**. | Inspect picker options; no curl token needed. |
| Mo-04 | Picker is harness-filtered for Claude (FE) | Switch harness to `claude`. | Open the model picker dropdown. | Only Claude-compatible models appear. OpenAI models are absent. Surface: **FE**. | Inspect picker options; no curl token needed. |
| Mo-05 | Wrong model + right harness | Configure `model: gpt-4o-mini`, harness `claude`. | Submit the run. | The system either rejects the config or the error message names the provider mismatch. The run does not silently use a fallback model. | `4f9a2c08` |

---

## Axis 5 — Custom connections

A custom connection is a named credential stored in the project vault under a
user-supplied key. This is distinct from a platform-managed provider key.

| # | Scenario | Configure | Action | Expected result | Verify token |
|---|----------|-----------|--------|-----------------|--------------|
| Cn-01 | Custom connection created and surfaced | Create a dummy custom connection in the playground vault: name `qa-dummy-conn`, value `QA_DUMMY_SECRET_TOKEN`. | Inspect the connections list. | The connection appears under its name. No provider key is created for it. | Manual check; no curl token. |
| Cn-02 | Custom connection injected into run | Configure an agent that uses a gateway tool whose secret is `qa-dummy-conn`. Use harness `agenta`, `gpt-4o-mini`. | Ask the agent to call the gateway tool. | The tool call receives the `QA_DUMMY_SECRET_TOKEN` value. Verify by having the tool echo the token (a test endpoint), or check the runner logs. | `7d50b1e3` |
| Cn-03 | Missing custom connection — error | Remove `qa-dummy-conn` from the vault. Re-run the same agent. | Submit the same task. | The run fails with an error that names the missing connection (`qa-dummy-conn`), not a generic auth failure. | `29c4f8a6` |

---

## Axis 6 — Errors

### 6a — Missing API key → error in UI

| # | Scenario | Configure | Action | Expected result | Verify token |
|---|----------|-----------|--------|-----------------|--------------|
| Er-01 | Remove OpenAI key, pi_core | Remove the OpenAI API key from the project vault. Use harness `pi`, `gpt-4o-mini`. | Send a message. | The playground shows an error. The error names OpenAI as the provider. The run does not hang silently. | `b8e30f45` |
| Er-02 | Remove Anthropic key, Claude | Remove the Anthropic API key from the project vault. Use harness `claude`, `claude-haiku-3-5`. | Send a message. | The playground shows an error. The error names Anthropic as the provider. The run does not hang silently. | `c1d72a89` |

### 6b — Error types → traces generated and correct

| # | Error type | Configure | Action | Expected result | Verify token |
|---|-----------|-----------|--------|-----------------|--------------|
| Er-03 | MCP server error | Set up a remote HTTP MCP server that returns HTTP 500. Use harness `claude`. | Ask the agent to call the MCP tool. | A trace is generated. The trace contains an error span for the MCP call with the HTTP status code and server URL. The error span is not empty. | `e4a91c36` |
| Er-04 | HTTP-MCP unreachable | Set up a remote HTTP MCP server URL that is unreachable (connection refused). Use harness `claude`. | Ask the agent to call the MCP tool. | A trace is generated. The trace error span identifies the unreachable host and connection-refused cause, not a generic "tool failed". | `53f7b2d0` |
| Er-05 | Gateway tool auth error | Configure a gateway tool with a bad credential. Use harness `agenta`, `gpt-4o-mini`. | Ask the agent to call the gateway tool. | A trace is generated with an error span that names the tool and the auth failure. The reply reports the tool failure. | `9a8c1e74` |
| Er-06 | Code tool runtime error | Configure a code tool whose script always raises. Use harness `agenta`, `gpt-4o-mini`. | Ask the agent to call the code tool. | A trace is generated. The error span contains the stack trace or error message from the script. The trace is not silently dropped. | `6b3d5f02` |

### 6c — Right provider named on error

The error message must identify the provider that was actually called, derived from the
harness/config, not from whichever provider key happens to be present first.

| # | Scenario | Configure | Action | Expected result | Verify token |
|---|----------|-----------|--------|-----------------|--------------|
| Er-07 | pi_core — provider named on missing key | Configure harness `pi`, provider `openai`. Remove the OpenAI key. | Send a message. | The error in the UI and in the trace names `openai`, not `anthropic` or a generic label. | `f0e25b18` |
| Er-08 | Claude — provider named on missing key | Configure harness `claude`, provider `anthropic`. Remove the Anthropic key. | Send a message. | The error in the UI and in the trace names `anthropic`, not `openai` or a generic label. | `3c6a9d40` |

---

## Axis 7 — Multiple providers

Both Pi (pi_core) and Claude support multiple backend providers. Test that the harness
actually routes to the configured provider, not a hardcoded default.

| # | Harness | Configure | Action | Expected result | Verify token |
|---|---------|-----------|--------|-----------------|--------------|
| Pr-01 | pi_core / openai | Harness `pi`, provider `openai`, model `gpt-4o-mini`. | Ask "What company made you? Include code 2e5f8c01 in your reply." | Reply identifies OpenAI. Trace `provider` field is `openai`. | `2e5f8c01` |
| Pr-02 | pi_core / azure | Harness `pi`, provider `azure`, model `gpt-4o-mini` (Azure deployment). Azure endpoint + key configured in vault. | Same question. | Reply comes from Azure OpenAI. Trace `provider` field is `azure`. | `d7b4e290` |
| Pr-03 | pi_core / gemini | Harness `pi`, provider `google`, model `gemini-1.5-flash`. Gemini key in vault. | Same question. | Reply identifies Google / Gemini. Trace `provider` field is `google`. | `1a9c4f63` |
| Pr-04 | Claude / anthropic | Harness `claude`, provider `anthropic`, model `claude-haiku-3-5`. | Ask "What company made you? Include code 8f3d2b57 in your reply." | Reply identifies Anthropic. Trace `provider` field is `anthropic`. | `8f3d2b57` |
| Pr-05 | Claude / bedrock | Harness `claude`, provider `bedrock`, model `anthropic.claude-haiku-3-5`. AWS credentials in vault. | Same question. | Reply comes from Bedrock. Trace `provider` field is `bedrock`. | `4c1e70a8` |

---

## Axis 8 — HITL (human-in-the-loop)

HITL is a sidecar-layer gate. Claude supports it; pi_core does not raise an approval gate.

| # | Harness | Configure | Action | Expected result | Verify token |
|---|---------|-----------|--------|-----------------|--------------|
| H-01 | Claude — approve → resume | Mark `bash` as HITL-gated. Use harness `claude`, `claude-haiku-3-5`. Open the playground (FE). | Ask Claude to run `echo "include code 6b2f9e14 in your reply"`. Approve in the HITL prompt. | The tool pauses; approval button appears in FE; after approval bash runs; reply contains `6b2f9e14`. Trace shows HITL pause → approval → resume. | `6b2f9e14` |
| H-02 | Claude — deny | Same setup as H-01. | Ask Claude the same question. Deny in the HITL prompt. | Tool call is cancelled. Claude's reply acknowledges it could not complete the task. Trace shows HITL deny event. | `c3a80d59` |
| H-03 | pi_core — no ask gate | Mark a tool as HITL-gated (same config). Switch to harness `pi`, `gpt-4o-mini`. | Ask the agent to use that tool. | No HITL pause; the tool runs directly or is unavailable. No HITL event in trace. Document actual behavior. | `5d71f2a3` |

---

## Axis 9 — Client tools

Client tools are tools whose execution happens on the client (browser / calling process),
not in the sandbox. The platform forwards the tool-call event to the client and the client
sends back the result.

| # | Scenario | Configure | Action | Expected result | Verify token |
|---|----------|-----------|--------|-----------------|--------------|
| Ct-01 | Client tool forwarded and shown | Configure a client tool in the agent config. Use harness `claude` or `agenta`. Open the playground (FE). | Send a message that triggers the client tool. | The FE shows a client-tool-call card. The user can provide a result. After the result is submitted, the agent continues. | `9e4c0b31` |
| Ct-02 | Client tool result returned correctly | Same setup. Provide a specific result value when the tool-call card appears. | After submitting the result, observe the agent's next reply. | The agent's next reply uses the client-provided result. The value is present verbatim in the reply or drives the logic. | `7f1a5e28` |

---

## Axis 10 — Generative UI (render tools)

Render tools return structured data that the FE renders as a component, not as raw text.

| # | Scenario | Configure | Action | Expected result | Verify token |
|---|----------|-----------|--------|-----------------|--------------|
| Gu-01 | Render tool returns a component | Configure an agent with a render tool (e.g. a data-render tool that returns a table). Use harness `claude` or `agenta`. Open the playground (FE). | Ask the agent something that triggers the render tool. | The FE displays the rendered component (table, card, chart) rather than raw JSON. The render-tool call appears in the trace. | `b2d60f47` |
| Gu-02 | Render tool — data shape correct | Same run. | Inspect the render-tool call event in the trace. | The data payload in the event matches the expected schema. No extra or missing keys. The FE rendered it without error. | `3a8e1c95` |

---

## Axis 11 — Both entrypoints

Every significant capability should work through both `/invoke` (single-turn, returns one
message) and `/messages` (streaming, server-sent events).

| # | Entrypoint | Configure | Action | Expected result | Verify token |
|---|-----------|-----------|--------|-----------------|--------------|
| Ep-01 | `/invoke` — basic reply | Harness `pi`, `gpt-4o-mini`. | `POST /invoke` with `"Include code 0d5c4b82 in your reply"`. | Response is a single JSON message containing `0d5c4b82`. Status 200. | `0d5c4b82` |
| Ep-02 | `/messages` — streaming reply | Same harness / model. | `POST /messages`, consume the SSE stream. | Stream delivers text-delta events followed by a finish event. Assembled text contains `f8a31e67`. Status 200, content-type is `text/event-stream`. | `f8a31e67` |
| Ep-03 | `/invoke` — tool use | Harness `agenta`, `gpt-4o-mini`, bash tool allowed. | Ask the agent to run `echo 2c9b5d40` via bash. | Response JSON contains `2c9b5d40` in the assistant text (not just in a tool-call event). | `2c9b5d40` |
| Ep-04 | `/messages` — tool use visible | Same harness / model / request as Ep-03. | Consume the SSE stream. | Stream includes a `tool_call` event frame followed by a `tool_result` event frame. Assembled text contains `2c9b5d40`. | `2c9b5d40` |
| Ep-05 | `/messages` — HITL pause visible | Harness `claude`, HITL-gated tool. | Submit via `/messages`. Do NOT approve at the gate. | Stream pauses and delivers a `hitl_approval_request` event frame before the tool-result frame. Stream does not close prematurely. | Manual check; record the event type. |

---

## Axis 12 — Tracing

Traces must be generated for all run types including error cases. The trace must carry the
skills fields and the Agenta builtin skill entries.

| # | Scenario | Configure | Action | Expected result | Verify token |
|---|----------|-----------|--------|-----------------|--------------|
| Tr-01 | Trace generated for successful run | Any harness, any model. | Send a message that completes successfully. | A trace appears in the Agenta traces UI. The trace has a non-null `trace_id` and `span_id` in the `/invoke` response. | Manual check against trace UI. |
| Tr-02 | Trace generated for error run | Remove an API key (re-use Er-01 or Er-02 setup). | Send a message. | A trace is generated even though the run failed. The trace contains an error span. The trace is NOT absent or empty. | Manual check against trace UI. |
| Tr-03 | Trace contains skills_linked | Run with an `agenta` harness skill configured (re-use S-01 or S-03). | Inspect the trace in the traces UI or via the tracing API. | The top-level span contains a `skills_linked` attribute listing the configured skill(s). | Check attribute presence in trace. |
| Tr-04 | Trace contains skills_used | Same run. | Inspect the same trace. | The top-level span contains a `skills_used` attribute listing only the skill(s) actually called. `skills_linked` minus `skills_used` should be empty for a run where the skill was triggered. | Check attribute presence and value. |
| Tr-05 | Trace contains Agenta builtin skills | Run with harness `agenta`, no author skills, so only builtins load (re-use S-05). | Inspect the trace. | `skills_linked` contains the builtin skill name(s) from `agenta_builtins.py`. `skills_used` contains the one(s) called. Neither field is empty. | Check attribute values name the builtin(s). |
| Tr-06 | Trace model and provider fields correct | Any run with a configured model+provider. | Inspect the trace top-level span. | The `model` attribute matches the config `model` value. The `provider` attribute matches the config `provider`. Neither is a default fallback value. | Check both fields against config. |

---

## Axis 13 — Sandbox teardown / no-leak

A Daytona (E3) run provisions a cloud sandbox and the runner deletes it in its `finally`
(`destroySandbox()` -> `provider.destroy()` -> `sandbox.delete()`). There is NO server-side
auto-stop backstop: the sandbox-agent SDK forces `autoStopInterval: 0` (auto-stop disabled)
and the runner's `ephemeral: true` only auto-deletes a sandbox *when it stops* — which never
happens on its own. So a sandbox the runner fails to delete (process killed mid-run, container
stopped, OOM) leaks and runs until billing kills it. This is the failure that has drained
cloud credits before. Assert the count does not grow.

List sandboxes with the Daytona SDK (`daytona.list()` from `qa/scripts/` or the WP-3
`archive/wp-3-daytona-sandbox/poc/cleanup.py` pattern). One-liner with `uv`:

```bash
DAYTONA_API_KEY="$SANDBOX_AGENT_DAYTONA_API_KEY" \
DAYTONA_API_URL="$SANDBOX_AGENT_DAYTONA_API_URL" \
DAYTONA_TARGET="$SANDBOX_AGENT_DAYTONA_TARGET" \
uv run --with daytona python -c '
import os
from daytona import Daytona, DaytonaConfig
d = Daytona(DaytonaConfig(api_key=os.environ["DAYTONA_API_KEY"], api_url=os.environ.get("DAYTONA_API_URL","https://app.daytona.io/api"), target=os.environ.get("DAYTONA_TARGET","eu")))
boxes = [b for b in d.list() if str(b.state) not in ("SandboxState.ARCHIVED","SandboxState.DELETED")]
print(len(boxes))
for b in boxes: print(f"  {b.id} {b.state} {getattr(b,\"labels\",{})}")
'
```

| # | Scenario | Configure | Action | Expected result | Verify token |
|---|----------|-----------|--------|-----------------|--------------|
| Lk-01 | No leak after a clean Daytona run | E3 (`sandbox=daytona`), harness `pi`, `gpt-4o-mini`. Credits confirmed available. | List sandboxes (record count N). Send one message that completes. Wait for the response, then list again. | The live (non-archived/deleted) sandbox count returns to N. It does NOT stay at N+1. The run's sandbox id is gone (`delete`d), not merely `STOPPED`. | Compare before/after count; capture both lists. |
| Lk-02 | No leak after a Daytona run that errors | E3, harness `pi`, `gpt-4o-mini`, but force an error (bad model id or removed provider key, re-use an Axis 6 setup). | List (count N). Send the failing message. List again. | Count returns to N. The `finally` deletes the sandbox even though the run returned `ok:false`. | Before/after count. |
| Lk-03 | No leak after a client disconnect mid-run | E3, harness `pi`. | List (count N). `POST /messages` and drop the connection before the run finishes (close the curl). Wait, then list. | Count returns to N. `res.on("close")` aborts the run, the `finally` still deletes the sandbox. | Before/after count. |
| Lk-04 | Process-kill leaves a leak (KNOWN GAP — record, do not assert pass) | E3, harness `pi`. | List (count N). Start a run, then SIGKILL / `docker stop` the runner (`agent-pi`) container mid-run. Restart it. List again. | Count stays at N+1: the killed process never ran its `finally`, and with auto-stop disabled the leaked sandbox does not self-reap. Record as a finding; clean up manually with `cleanup.py`. | Before/after count; expect a leak. This is the backstop gap. |

---

## Sweep execution notes

- Run axes in order: Permissions → MCP → Skills → Model → Connections → Errors →
  Providers → HITL → Client tools → Generative UI → Entrypoints → Tracing → Sandbox
  teardown.
- Record each cell result (pass / fail / blocked) in a companion run log. On fail,
  open a finding in `findings.md` with the verify-token and error detail.
- Use `gpt-4o-mini` for all Pi/agenta cells and `claude-haiku-3-5` for all Claude cells.
  No exceptions unless the model itself is the thing under test (Axis 7).
- The verify token must appear verbatim in the reply for a cell to count as pass. If the
  model paraphrases or omits it, the cell is a fail.
- Save raw request + response for each API cell under `qa/runs/final-sweep/`.
