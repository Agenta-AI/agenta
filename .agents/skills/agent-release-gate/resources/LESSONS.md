# QA lessons: the traps, and how to not re-learn them

Written during the 2026-07-14 pre-release QA. Every item here cost real time to discover. Read
this BEFORE writing another agent QA test — most of these produce a **green test that proves
nothing**, which is worse than a red one.

The one-line summary: **assert on the wire and on side effects, never on model prose — and make
your test client behave EXACTLY like the real frontend, or you are testing your own bug.**

---

## 1. The test client must replay history byte-faithfully, or every turn silently goes COLD

**The trap.** Our driver replayed each assistant turn as a text-only message
(`{role:"assistant", parts:[{type:"text",...}]}`), dropping the assistant's **tool parts**.

The runner fingerprints the conversation over **(ordered user texts, ordered deduped tool-call
ids, user-turn count)** — `session-pool.ts:226` `historyFingerprint`, and `:252`
`expectedNextHistoryFingerprint`, which folds in the tool-call ids the runner emitted last turn.
A replay with no tool-call ids therefore **cannot match** after any tool-using turn:

```
[keepalive] mismatch (history) key=…; evict + cold
```

**Why it poisons everything.** Every turn goes cold → a fresh harness process → the runner replays
a hand-rendered transcript instead of the harness's real context. So:
- warm/cold numbers are meaningless (nothing was ever warm),
- **compaction never triggers** (the harness context never accumulates), so a long-context /
  "loses information" test can pass while testing nothing at all.

**The rule.** Echo back the **full** assistant `UIMessage.parts` — text parts *and* `tool-<name>`
parts with `toolCallId`, `input`, `state`, `output` — exactly as the AI SDK does
(`web/packages/agenta-playground/src/state/execution/agentRequest.ts:401`). If your driver
synthesizes assistant turns, it is not testing the product.

**The tell.** `grep 'mismatch (history)'` in the runner log. If it fires on turns your client
believes are warm, your client is the bug.

## 2. Never assert on the model's prose. It will lie to you.

First version of the tool test asked the agent to run `echo "QA-BASH-$((6*7+1))"` and asserted the
reply contained `QA-BASH-43`. The model **computed 43 itself and reported it without running
bash** — so a *denied* tool call still produced a "passing" reply. The wire said denied; the text
said success.

**The rule.** Ground truth is the frame stream:
- tool executed → `tool-output-available`
- tool refused → `tool-output-error` / `tool-output-denied`
- approval raised → `tool-approval-request`
A token in the text is only ever *corroborating* evidence, and only if the model **cannot compute
it** (use a container hostname, a random file's contents — never arithmetic stated in the prompt).

## 3. Scope tool assertions to ONE tool call, keyed by its INPUT

A turn routinely contains several tool calls — an auto-approved read-only one alongside the gated
one. A turn-wide "did any tool run?" gives false failures.

And you cannot key on `toolCallId`: **on approval-resume the harness RE-ISSUES the gated call under
a brand-new `toolCallId`**. You cannot key on the tool name either: Claude calls the shell
`Terminal`, Pi calls it `Bash`. **Key on the tool's `input`** (the command itself).

## 4. `tool-input-available` carries INCOMPLETE input, and the tool name changes case mid-stream

The frame fires repeatedly for one call, streaming a progressively-built partial input:

```
toolName "bash"  input {"command":"echo \"QA-BASH-"}          <- partial!
toolName "bash"  input {"command":"echo \"QA-BASH-$(hostname"}
toolName "Bash"  input {"command":"echo \"QA-BASH-$(hostname)\""}   <- complete; name case flips
```

Take the **last** frame per `toolCallId`. Taking the first — a reasonable reading of "available" —
approves a **truncated command under the wrong name**; the runner keys approval decisions by
name+args, so the decision misses the parked gate and **the approval re-parks forever**.
(Reported as F-5: the frame name is a genuine wire-hygiene bug.)

## 5. Approvals are IN-BAND. The REST route is a different product.

The browser approves by re-POSTing the whole message history to `/invoke` with the tool part set to
`state:"approval-responded"`, `approval:{id, approved}`. There IS a REST endpoint
(`/api/sessions/interactions/{id}/respond`) but it is the **out-of-band Slack/trigger** path.
Testing it tests code the UI never runs.

## 6. A paused turn "finishes"

An approval-paused turn ends with `finish.finishReason: "other"`, not a distinct status. "The turn
ended" does NOT mean "the turn completed". Assert the reason.

## 7. `code` tools do not exist on the product path

The sidecar rejects them: *"Code tools are not supported by the sidecar."* They only work against
the in-process service — which is what the OLD driver (`run_matrix.py`) targets, and why copying
its scenarios into a product-path test fails instantly. The product's real tool surface is
`builtin` / `gateway` / `mcp`.

## 8. Gateway tools: discovery output is NOT config input, and the action has no prefix

- The action is **`FETCH_EMAILS`**, not `GMAIL_FETCH_EMAILS`. The prefixed name appears inside the
  tool's own description text, which is how you get seduced into using it. Wrong name → run fails
  with `Action not found: composio/gmail/GMAIL_FETCH_EMAILS (HTTP 404)`.
- `/api/tools/discover` returns the tool WITH `input_schema` + `description`; `GatewayToolConfig`
  **forbids** those keys. Feeding discovery's own output back into the agent config 500s with
  `extra_forbidden`. Strip to `{type, provider, integration, action, connection, name, permission}`.
  (Reported as F-8 — the round trip should just work.)

## 9. NEVER diagnose from a run that overlapped a container restart

A full matrix run showed every cell failing with 500s (`Could not verify credentials … 404`), plus
a UI-visible `404 on /api/workflows/revisions/resolve`, plus `[sessions/persist] DROPPED … fetch
failed` and `getaddrinfo ENOTFOUND api`. **All phantoms** — another agent was recreating the
api/worker containers at that moment. Everything went green on re-run.

Check `docker ps` uptimes before believing a failure. Re-run before reporting.

## 10. Read-only by construction when real accounts are connected

The project has live Gmail and GitHub connections. QA must never send mail, reply to a thread, or
write to GitHub as a side effect. Derive tools from read-only use-cases AND filter any action whose
name contains SEND/REPLY/CREATE/DELETE/UPDATE/MODIFY/TRASH/DRAFT/MERGE before it reaches an agent.

## 11. The product fails OPEN, so absence of an error means nothing

The recurring shape of every serious bug this pass: **a component fails, the runner logs it and
carries on.** The turn succeeds. The UI looks normal.

- mounts 503 → run in a throwaway `/tmp` cwd, every file lost (F-1)
- Pi permission extension can't install → **run with no enforcement**; `ask` never asks, `deny`
  never denies (F-3)
- Daytona's tunnel to the store fails → skip the mount, "not fatal"; files never persist (F-7)
- session records fail to POST → dropped after 3 retries, turn proceeds

**Therefore: a passing turn is not evidence.** For every capability, verify the side effect
(the file is really there next turn; the commit really exists) and grep the runner log for
`degraded|skipped|without this mount|tunnel discovery failed|DROPPED|cold`.

## 12. Environment-shaped bugs hide behind image differences

Pi's permission enforcement failed only on the deployment's image, because
`PI_CODING_AGENT_DIR=/pi-agent` doesn't exist there and the runner runs as uid 1000; our EE dev
image runs as root and ships the dir. Same code, opposite behavior. **Always check the container's
user and the actual paths** (`docker exec … id; ls -ld <dir>`) before concluding the code is fine.
And note a workaround applied with `docker exec` is **lost on container recreate** — re-verify it
before every batch.

---

## 13. Findings expire on redeploy — re-run blocker-level findings after the stack is rebuilt

F-9 ("Claude harness never resumes its native session") was CONFIRMED across 72h of real traffic
and triaged as a release blocker. A deployment repair landed later the same day, pulling in recent
upstream fixes. Nobody re-ran F-9 against the rebuilt stack before trusting it — until a decisive
cold-context experiment on 2026-07-14 showed native session resume now working 4/4 runs, downgrading
F-9 to a residual resilience concern (see STATUS.md).

**The trap.** A deployment under active repair invalidates earlier observations made against it.
Once the repair lands, the finding is stale, not necessarily wrong — but you don't know which
until you re-check. Treating "CONFIRMED" as permanent past a redeploy is how a fixed bug survives
in a triage doc as a blocker.

**The rule.** For any blocker-level finding, record WHICH build/commit/deploy window it was
observed on. After any redeploy that touches the relevant code path, re-run the decisive experiment
before shipping a release decision on that finding — do not just re-read the old evidence.

## 14. The v0 revision is a SEED — a committed config only persists on the SECOND commit

Committing an agent config as a workflow revision (`POST /api/workflows/revisions/commit`) looks
like it stores your `data.parameters` immediately. It does not on the first commit. The DAO
force-nulls `data`/`flags`/`meta` for **version 0** (`api/oss/src/dbs/postgres/git/dao.py`
`_null_revision_fields`, `if revision.version == "0"`). So a fresh variant's first commit is an
empty seed; your config lands on the **second** commit (v1). A test that commits once and asserts
`data.parameters == X` fails with `KeyError: 'data'` and looks like a broken endpoint — it is not.
Commit twice (seed, then the real change) and assert v0→v1 plus the changed field surviving a
`GET /api/workflows/revisions/{id}`. Also: `data` is `extra="forbid"` — only
`{uri,url,headers,runtime,script,schemas,parameters}` are accepted.

Second trap in the same area: this is a WORKFLOW-revision commit, NOT the in-stream
`data-committed-revision` SSE frame (which is a different mechanism — the agent committing during a
turn) and NOT a git commit. The playground's Save/Commit button hits the REST route above.

## 15. User MCP servers are Claude-only, public-HTTPS-only, and the harness dials them

Three things will each silently break an MCP smoke test:

- **Pi rejects any run that declares `mcps`** (`run-plan.ts` `PI_USER_MCP_UNSUPPORTED_MESSAGE`).
  User MCP needs a harness with `capabilities.mcpTools` — i.e. **Claude**. Do not smoke-test MCP on
  a Pi cell; SKIP it there.
- **A local MCP server is unreachable.** The SDK resolver AND the runner both run an SSRF guard
  (`assert_endpoint_url_allowed` / `validateUserMcpUrl`) that rejects `http://` and
  private/loopback/metadata hosts unless `AGENTA_INSECURE_EGRESS_ALLOWED` /
  `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` is set (neither is, on bighetzner). Use a **public HTTPS**
  server. DeepWiki (`https://mcp.deepwiki.com/mcp`, no auth) works.
- **The harness — not the runner process — opens the connection**, from the runner host on `local`
  (from the sandbox on Daytona). The endpoint must be reachable from wherever the harness runs.

The config entry is a full object, not a URL string:
`{"name","connection":{"type":"http","url":...},"policy":{"tools":{"mode":"all"}}}`. Assert on the
wire: a `tool-output-available` frame for a tool named `mcp__<server>__<tool>`.

## The checklist for the next QA run

1. `docker ps` — is anything restarting? If yes, wait.
2. Does the runner have its harness dirs (`/pi-agent`)? Is it root or not?
3. Drive the **product path** (`/services/agent/v0/invoke`), not the service `/invoke`.
4. Echo history **faithfully** (tool parts included), then confirm `hit-continue` in the log.
5. Assert on frames + side effects. Never on prose.
6. After every capability passes, grep the log for silent degradation.
7. Re-run anything that failed once before reporting it.
8. Before trusting an existing blocker-level finding, check whether the stack has been redeployed
   since it was observed — if so, re-run the decisive experiment.
