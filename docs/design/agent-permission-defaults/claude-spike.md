# Claude permission spike

## Result

Observed on 2026-09-07, approximately 18:03-18:07 UTC. This report implements the
investigation in [spikes.md](spikes.md), not a production change.

- **421 existing tests passed:** 33 SDK tests and 388 runner tests. No tests skipped.
- **Native settings loader observed:** project `acceptEdits` and `bypassPermissions`
  resolve to `default` with the installed ACP settings loader. Explicit rule lists
  survive. This is a loader diagnostic, not a Claude tool-execution test.
- **Live product attempt blocked:** the existing C1 chat gate reached the local
  deployment but failed before model execution because the Claude subscription mount
  was missing. No native tool or approval event occurred.
- **General non-Pi relay Ask caveat confirmed by an existing test:** a forged Ask
  record executes without consuming a grant. Marker-carrying commits have an
  additional content-authorization check; they must not be equated with general Ask.

Recommendation: retain the approved shared Allow-default direction and explicit
buildkit Ask policies, but do not introduce a Claude native-mode override from this
spike. The tests support the runner's policy decisions, not a claim that every native
Bash/write/edit path now runs unattended or that every explicit Ask has a complete
forged-relay boundary. Finish live verification with an authenticated isolated Claude
runner before making those claims.

## Environment

| Item | Observed value |
| --- | --- |
| Workspace HEAD | `bfe9b2278527ebd6fea2d960e74d8c218d1f4da3` |
| Worktree | Dirty, shared with other agents. Tests used working-tree files, not an isolated commit. |
| Selected deployment | `agenta-ee-dev-tools`, `http://144.76.237.122:8780` |
| API health | HTTP 200, `{"status":"ok"}` |
| Runner image | `agenta-ee-dev-tools-runner:latest` |
| Runner image ID | `sha256:4cd7bc9169eca8ef35551b9f8d1d03c48ae0be04b0d3558767120c7b02469029` |
| Runner source mount | `/home/mahmoud/code/agenta-2-worktrees/fd-pin/services/runner/src` to `/app/src`; not this checkout |
| Runtime | Node `v24.20.0`, container UID/GID 0 |
| Claude ACP | `@agentclientprotocol/claude-agent-acp` 0.58.1 |
| ACP SDK dependency | `@anthropic-ai/claude-agent-sdk` 0.3.205, from installed ACP package metadata |
| Claude CLI | `command -v claude` returned no path. No executed CLI version established. |
| Subscription | No credentials at checked `/root/.claude/.credentials.json` or `/home/node/.claude/.credentials.json`; no `CLAUDE_CONFIG_DIR` in runner environment. Mounted Pi auth contains only `openai-codex`. |
| Daytona | Enabled alongside local; configured snapshot `agenta-agent-sandbox-v1`; Daytona key populated. No sandbox created or image readiness verified. |

Discovery commands, from the repository root unless stated otherwise:

```bash
git status --short
git rev-parse HEAD
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
curl --max-time 15 -sS -w '\nHTTP %{http_code}\n' http://144.76.237.122:8780/api/health
docker inspect agenta-ee-dev-tools-runner-1 --format '{{.Image}} {{json .Mounts}}'
docker logs agenta-ee-dev-tools-runner-1 --since 5m --tail 15
docker logs agenta-ee-dev-tools-runner-1 --since 3m --tail 35
```

Read-only `docker exec` inspected command availability, package metadata, auth-file
presence/provider names, configured provider names, and UID. Credential values were
not printed or stored. Other running stacks were discovered but not used for runs.

The selected runner hot-reloaded at 18:05:15 UTC due to changes outside this spike.
The gate followed that reload and returned a specific missing-mount error, consistent
with the environment inspection. This is an authentication blocker, not evidence of
a permission regression. No reload, restart, rebuild, or configuration change was
requested by this spike.

## Existing tests

SDK command, working directory `sdks/python`:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --no-sync pytest -p no:cacheprovider oss/tests/pytest/unit/agents/adapters/test_claude_settings.py -q
```

Result: **33 passed in 11.13s**. Covers author modes/rules, invalid-mode filtering,
sandbox-derived denies, per-server and per-tool rules, all four runner defaults,
and the separate client-tool permission behavior. These tests check rendered JSON,
not whether Claude accepts or executes it.

Runner commands, working directory `services/runner`:

```bash
pnpm exec vitest run --project unit --reporter=default tests/unit/permission-plan.test.ts tests/unit/permission-parity.test.ts tests/unit/tool-relay-guard.test.ts tests/unit/commit-authorization.test.ts tests/unit/sandbox-agent-acp-interactions.test.ts tests/unit/pending-approval-pause.test.ts tests/unit/interaction-decision-seed.test.ts tests/unit/interaction-resolve-once.test.ts tests/unit/session-keepalive-approval.test.ts tests/unit/relay-loop.test.ts
pnpm exec vitest run --project unit --reporter=default tests/unit/executable-tools.test.ts tests/unit/responder.test.ts tests/unit/sandbox-agent-workspace.test.ts
pnpm exec vitest run --project unit --reporter=default tests/unit/execution-authorization.test.ts
```

Results: **260 passed / 10 files / 6.43s**, **59 passed / 3 files / 0.36s**,
and **69 passed / 1 file / 0.84s**. Installed Vitest reported 4.1.9.
Default-only reporting avoids the package script's repository JUnit output.

Tests exercise real policy/relay code with fake harnesses and callback responses.
Temporary relay files use the tests' randomized directories, not the other spike's
fixtures. Expected failure-path logs include interaction fetch failures. One
keepalive test also attempted trace export to `cloud.agenta.ai` and received HTTP
401; this was test-suite behavior, not a successful customer mutation or live
Claude result. No broad release suite or external integration journey was run.

## Native settings

The isolated diagnostic imports the installed ACP `SettingsManager` and
`resolvePermissionMode`, loads four scratch project settings files, prints the
effective permissions, and disposes watchers. It contains no assertions and starts
no model. Existing repository tests above remain the verification evidence.

```bash
HOME=/tmp/opencode/permission-claude-spike CLAUDE_CONFIG_DIR=/tmp/opencode/permission-claude-spike/.claude node /tmp/opencode/permission-claude-spike/inspect-native-settings.mjs
```

| Project `permissions.defaultMode` | Observed effective mode | Other settings |
| --- | --- | --- |
| `default` | `default` | Allow `Bash`, `Read`, `Write`, `Edit`; Ask `mcp__agenta-tools__commit_revision`; Deny `WebFetch` retained |
| `acceptEdits` | `default`, mode field removed | Allow `Bash`, explicit commit Ask, and `WebFetch` Deny retained |
| `plan` | `plan` | Explicit commit Ask retained |
| `bypassPermissions` | `default`, mode field removed | Explicit commit Ask retained |

The loader calls SDK `resolveSettings` then `filterEscalatingDefaultMode`
(`node_modules/@agentclientprotocol/claude-agent-acp/dist/settings.js:88-92`).
The adapter reads that result into `permissionMode` and calls the SDK with
`settingSources: ["user", "project", "local"]`
(`dist/acp-agent.js:2826,2858,2885-2887`). Thus successful SDK JSON rendering alone
does not establish that an escalating project mode will take effect.

The following read-only command also exercised the resolver inside the actual
root-running container, independently of the project-source filter:

```bash
docker exec agenta-ee-dev-tools-runner-1 sh -c 'id; node --input-type=module -e '\''import {resolvePermissionMode} from "/app/node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js"; for(const mode of ["default","acceptEdits","plan","bypassPermissions"]){console.log(mode,resolvePermissionMode(mode))}'\'''
```

Results: `default -> default`, `acceptEdits -> acceptEdits`, `plan -> plan`,
`bypassPermissions -> default`, with the explicit warning that bypass is unavailable
when running as root. This isolates root-mode rejection from project-source filtering.

Host and container ACP files had matching SHA-256 hashes:

- `acp-agent.js`: `c62e8a74cfa5b73fdd32d12e7a6f3b8848297f3cd0de6ef3f28137ef3bd95fde`.
- `settings.js`: `629348525ddd007ace9c06a16a19af6877af2a090b58255dd7f5974a6bdf2932`.

No mixed user/project/local/managed precedence matrix was executed. The SDK parser
currently accepts only `default`, `acceptEdits`, `plan`, and `bypassPermissions`
(`sdks/python/agenta/sdk/agents/permission_rules.py:8-10`), although the installed ACP
resolver recognizes additional names. This observation is not a proposal to expose
them or to relocate settings to a more trusted source.

## Live attempt

An isolated wrapper reused `api/oss/tests/pytest/utils/accounts.py:create_account`,
then queried that account's projects and ran the existing C1 chat-only gate. It
exported all three gate credentials explicitly and disabled credential-file fallback.
The account has no seeded defaults or customer integrations. Its random fixture email
and gate session UUID are independent of the Codex spike.

```bash
PYTHONDONTWRITEBYTECODE=1 uv run /tmp/opencode/permission-claude-spike/run_isolated_gate.py
```

The wrapper's child command was:

```bash
uv run /home/mahmoud/code/agenta-2/.agents/skills/agent-release-gate/resources/qa_product.py --cell C1 --only chat --env-file /dev/null
```

| Evidence | Result |
| --- | --- |
| Project | `01a07d0b-c59d-7f93-990f-3ab24cbebe76` |
| Session | `eeea0f5b-7492-4d4d-b2ff-1961ca6cba5e` |
| Turn | `f072dc44-8b41-4221-b1c6-0b6fa50f3b37` |
| Configuration | Claude/local, model `sonnet`, provider `anthropic`, `self_managed`, no authored harness permissions |
| HTTP | 200, 291ms; gate process exit 1 |
| SSE | `start`, `start-step`, `message-metadata`, `data-agent-status`, `data-agent-error`, `error`, `finish-step`, `finish` |
| Tools / approvals / reply | No tools, no approval, empty reply, no successful stop |
| Error | `runtime_provided local run requires a mounted subscription: set PI_CODING_AGENT_DIR (Pi), CLAUDE_CONFIG_DIR (Claude), or CODEX_HOME (Codex) to a read-write mount of your harness login.` |
| Artifact | `/tmp/opencode/permission-claude-spike/gate-runs/20260907-200518/results.json` and adjacent `summary.md` |

One failed setup/run attempt was made. No further attempts to install Claude, attach
credentials, stock provider keys, or alter shared containers were made. Managed-auth
and Daytona cells were not invoked. The fresh test account and failed-session records
remain; no saved agent revision, scratch workspace tool mutation, or customer resource
was created by the model.

## Policy and grant boundaries

### Runner decisions

`services/runner/src/permission-plan.ts:147-161,267-278,329-336` checks the operator
deny switch, explicit tool permission, explicit server permission, matching rules,
then the general default. Matching runner rules rank Deny above Ask above Allow.
Allow reads requires an explicit read-only hint; an unknown hint asks. General Allow
does not erase a resolved tool's explicit Ask or Deny. These decisions have executed
unit coverage, but the native harness must reach the gate for the runner to answer it.

`claude_settings.py:205-263` renders per-resolved-tool rules using the general
default. It does not turn general Allow into a native `defaultMode`, nor synthesize
native Bash/Write/Edit allow rules from that default. Native gates that do arrive
over ACP can receive an automatic allow response without a human card
(`sandbox-agent-acp-interactions.test.ts:110`). A native tool auto-allowed or denied
inside Claude never asks that responder. Live gate presence remains unverified.

### General Ask and local MCP

The executed `tool-relay-guard.test.ts:272-307` demonstrates that a general non-Pi
Ask record executes with an empty grant ledger and leaves a later grant unconsumed.
Hard Deny is still enforced. This is a concrete unit-level residual, not a live
exploit attempt.

Normal local Claude executable MCP calls have another gate:
`run-turn.ts:894-955` records ACP allows and installs `buildExecutableToolGate`
only for non-Pi/local. `executable-tools.ts:68-110` consumes a matching grant when
the call would otherwise ask, or parks without one. Executed tests cover one-use
grants, repeated calls, and Deny winning over a grant. That loopback gate does not
make a directly forged relay file equivalent to a legitimate MCP call. Daytona does
not install this local gate.

### Marker commits

`run-turn.ts:823-841,1003` attaches a separate marker authorizer on every harness.
`approved-content.ts:145-165` uses the actual permission plan for inline resolution,
not the relay's non-Pi Ask pass-through. An explicit commit Ask therefore blocks the
inline-Allow exception even when the general default is Allow.

Executed tests establish refusal without a minted record, exact argument and catalog
binding, frozen content despite later file changes, one execution across concurrent
records, duplicate refusal, denied-record disposal, and matching across different
harness/relay call IDs. A cold authorizer has an empty store; ACP wiring tests verify
that a replayed marker approval asks again. Warm-state tests preserve the parked
store. These tests use mocks for harness/network execution, not live Claude resumes.

Two limits matter:

- Calls without markers pass through the marker authorizer
  (`commit-authorization.ts:364-365`). Its guarantees are not guarantees for every
  buildkit commit or every platform Ask tool.
- **Source-only pending-approval concern:** ACP mints the marker record before
  presenting the pending card (`acp-interactions.ts:333-351,675-688`). The authorizer
  then verifies and consumes records without a separate human-approved flag
  (`commit-authorization.ts:379-424`). Existing tests labeled approved execution mint
  and execute directly. They establish content binding, not that a forged identical
  record cannot execute while the card is unanswered. Whether relay shutdown/timing
  closes that window needs a dedicated existing-suite regression and controlled live
  test. No such race was executed here; do not label it safe or a reproduced exploit.

Session isolation depends on separate environment-owned stores, not an explicit
session-ID comparison in `ExecutionAuthorizationStore.verifyAll`. Live cross-session
replay and pending-card abandonment were not tested. Duplicate decision handling and
history/credential mismatch eviction have unit coverage, but do not substitute for
those missing live checks.

## Matrix status

| Required cell | Evidence obtained | Live status |
| --- | --- | --- |
| Bash, Read, Write, Edit with general Allow | Runner policy/ACP unit tests; settings rendering inspection | Blocked before tool execution |
| Allow reads, Ask, Deny, conflicting explicit policies | Executed decision and renderer tests | Not run |
| Native modes and loaded settings | Real installed settings-loader diagnostic and root resolver observation | No native tool execution |
| Explicit buildkit Ask, approve/deny/no prior side effect | Generic explicit-Ask, ACP, local MCP, and marker unit tests | Not run; pending forged-marker boundary unresolved |
| Abandon approval | Lifecycle cleanup source and related unit coverage only | Not run |
| Warm approve/deny and duplicate decision | Executed keepalive and interaction tests with fake harness | Not run |
| Cold reconstruction and marker re-gating | Executed marker and ACP wiring tests | Not run; no eviction attempted |
| Exact/changed arguments, content change, replay | Executed authorization tests | Not run |
| Forged general Ask relay | Existing real-relay-loop test with fake callback confirms grantless execution | Not attempted against deployment |
| Forged marker relay without a record | Existing relay test confirms refusal and zero callback dispatch | Not attempted against deployment |
| Cross-session grants | Source-level environment scoping | Not run |
| Local subscription | One C1 chat gate failure with explicit missing-mount error | Blocked |
| Local managed / Daytona managed | No provider credential provisioned in isolated account; snapshot configured only | Not run |

## Next evidence

Use a separately authenticated isolated Claude runner without changing this shared
deployment. Run the existing C1 tool/approve/deny journeys, then the saved-revision
commit and marker gates in a disposable project. Note that C1 approve/deny exercises
native Bash, not explicit buildkit Ask. Record tool outputs and stored side effects,
not model claims, and verify sandbox identity for any warm/cold claim.

Before broadening native allow rules or modes, cover unanswered/denied/abandoned
explicit Ask, same-argument forged requests while a marker card is pending,
non-marker buildkit calls, cross-session replay, and cold marker re-gating. The
release-gate skill already records a missing live cold stale-approval cell; changing
history or restarting a shared runner is not a valid substitute.

Only this report and isolated artifacts under
`/tmp/opencode/permission-claude-spike` were manually written. No production files,
other agents' work, deployment configuration, commits, or pushes were changed.
