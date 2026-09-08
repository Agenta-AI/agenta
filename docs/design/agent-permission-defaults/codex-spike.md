# Codex permission spike

## Result

Run date: 2026-09-07. This is a reference report for the approved
[permission spike](spikes.md), not an implementation change.

**324 existing unit tests passed. Live native-tool verification is blocked.** The
fresh-account product gate returned HTTP 422 because the isolated project's OpenAI
connection had no usable credential. No Codex tool events, approvals, or file side
effects were produced by that request. Do not treat the unit results or deployed
bundle inspection as a live shell/file permission matrix pass.

The evidence supports keeping the current native mode and patch unchanged while
the separate new-agent default work proceeds. Changing the general permission
default does not itself add interception for Codex native tools. The general
non-Pi relay Ask gap is independently reproduced by an existing unit test; the
marker-commit authorization tests do not close that gap.

## Scope

- No production source edits, commits, pushes, deployment restarts, rebuilds, or
  shared configuration changes.
- Only this report and isolated artifacts under
  `/tmp/opencode/permission-codex-spike` were manually written.
- Tests used installed project environments, no project `uv sync`, no dependency
  installation into the shared SDK environment, no standard JUnit output path,
  and no pytest/Vitest result cache. Test temporary files used the distinct
  `TMPDIR` above, separate from the parallel Claude spike.
- One new account was created through the repository's `create_account` fixture.
  No customer project credentials or integrations were used. The account remains;
  no cleanup deletion was attempted. The failed gate created no agent workflow.
- Setup budget: one account/gate setup attempt, zero retries, below the cap of
  three. Missing credentials were not worked around by changing a shared runner.

The PEP 723 orchestration script ran with `uv run --no-sync --active`. UV reported
that `--no-sync` is a no-op for inline-metadata scripts and installed 15 packages
in an isolated script environment. It did not synchronize the shared project
environment. The script reuses the repository account fixture and product gate;
it contains no replacement verification assertions.

## Environment

| Item | Observed value |
| --- | --- |
| Local checkout HEAD | `bfe9b2278527ebd6fea2d960e74d8c218d1f4da3` |
| Worktree state | Pre-existing staged, unstaged, and untracked changes; other agents' files left untouched |
| Selected origin | `http://144.76.237.122:8780` |
| Compose project | `agenta-ee-dev-tools` |
| Health | `/api/health` returned `{"status":"ok"}` |
| Deployed source | Bind mounts from `/home/mahmoud/code/agenta-2-worktrees/fd-pin`, not this checkout |
| API image | `agenta-ee-dev-tools-api:latest`, ID `sha256:91d0d19ed428237352de75dd4f7c04777ccda842715bb87252c18d73c5f9745a` |
| Runner image | `agenta-ee-dev-tools-runner:latest`, ID `sha256:4cd7bc9169eca8ef35551b9f8d1d03c48ae0be04b0d3558767120c7b02469029` |
| Runner Node | `v24.20.0` |
| Installed ACP adapter | `@agentclientprotocol/codex-acp` `1.1.7` |
| Installed Codex package | `@openai/codex` `0.145.0` |
| Local test runner | Vitest `4.1.9` as actually invoked, not the package manifest's `^4.1.4` floor |
| Auth requested | Managed OpenAI, gate cell `X1`, model `gpt-5.6-luna` |
| Subscription availability | Selected runner has no `CODEX_HOME` and no Codex login mount; its `.pi` mount is not a Codex harness login |
| Daytona availability | Runner reports nonempty Daytona configuration variable names; no remote sandbox was acquired or inspected |

The API and runner had restart counts of zero. Their start times remained
`2026-09-07T17:50:42.01676794Z` and `2026-09-07T17:50:16.249007795Z`, respectively,
at the final inspection. Local tests therefore describe this checkout, while
image inspection and the credential rejection describe the selected deployment.

## Verification matrix

“Tested” below means the named existing test actually executed. Mocked ACP
requests and stubbed callbacks are not live harness execution.

| Cell | Status | Evidence and limit |
| --- | --- | --- |
| SDK native settings, managed/subscription rendering | Tested, 12 passed | `test_codex_settings_layers.py`; TOML construction only |
| Runner Codex modes | Tested, 4 passed | `codex-mode.test.ts`; default resolution and mocked session mode application |
| Image patch transform | Tested, 6 passed | `codex-acp-patch.test.ts`; fixture anchor, preservation, idempotency, drift rejection; no image built |
| Installed local image patch/version | Inspected | Real deployed bundle contains `on-request` next to `dangerFullAccess` |
| Managed/subscription home assets | Tested, 23 passed | `sandbox-agent-codex-assets.test.ts`; no live login |
| General Allow/Allow reads/Ask/Deny and conflicts | Tested | Permission-plan and shared parity fixture tests |
| Codex exec identity and MCP argument recovery | Tested | ACP interaction tests use command `pnpm test`, not `Bash`; late frame recovery and MCP envelope unwrapping |
| Local executable-tool gate | Tested, 11 passed | Grant consumption, no duplicate prompt, no grant override of Deny |
| General non-Pi forged Ask relay request | Tested, gap reproduced | Existing test executes the stub callback without any grant |
| General non-Pi forged Deny relay request | Tested, refused | Existing test observes zero stub callback calls |
| Marker-commit authorization | Tested, 27 passed | Frozen bytes, changed arguments, stale catalog, forgery, replay/concurrent single-use, cold-store refusal |
| Warm approval, duplicate answer, history mismatch | Tested, mocked lifecycle | Includes Codex ACP gate park/resume; not a live Codex session |
| Product preflight `X1/chat` | Executed, FAIL / credential-blocked | HTTP 422, no frames, no tools, no finish, no approval |
| Native shell under each general default | Blocked live | Default full-access behavior is source-only in this run |
| Native file read, write, and edit under each default | Blocked live | No file contents or actual native tool events observed |
| Explicit native rules conflicting with defaults | Source-only plus policy units | No live rule application or command execution |
| Platform Ask approve, deny, abandon | Blocked live | No live no-side-effect-before-approval claim |
| Warm/cold reconstruction and session isolation | Blocked live | No live sandbox IDs, mount fetch-back, or cross-session side-effect evidence |
| Exact/changed arguments, forged request, duplicate decision | Tested at unit seams only | No adversarial request sent to a deployment |
| Local managed environment | Blocked live | Fresh project has no usable OpenAI credential |
| Local subscription environment | Blocked live | No mounted Codex login on the selected runner; not reconfigured |
| Daytona managed environment | Blocked live | No project model credential; snapshot contents unverified |
| Daytona subscription environment | Not applicable to current supported path | Gate coverage documents subscription as local-only; not probed here |

No live safety cell passed. The gate's one FAIL is a setup blocker, not evidence
that Codex's native permission implementation failed.

## Native settings

The deployed adapter bundle was read from:

```text
/root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/@agentclientprotocol/codex-acp/dist/index.js
```

Its actual full-access preset contains:

```javascript
static AgentFullAccess = new _AgentMode(
  "agent-full-access",
  "Agent (full access)",
  "Codex can edit files outside this workspace and run commands with network access. Exercise caution when using.",
  "on-request",
  { "type": "dangerFullAccess" },
  "danger-full-access"
);
```

The same bundle's turn construction explicitly passes:

```javascript
approvalPolicy: agentMode.approvalPolicy,
sandboxPolicy: addAdditionalDirectoriesToSandboxPolicy(agentMode.sandboxPolicy, additionalDirectories),
```

These are deployed-source observations, not executed model turns. They show why
the config file and ACP mode are distinct controls:

| Layer | Current behavior |
| --- | --- |
| SDK author scalars | Renders valid `approval_policy` and `sandbox_mode` to `.codex/config.toml` |
| SDK filesystem reinforcement | `readonly`/`off` derives `sandbox_mode = "read-only"` only when the author did not supply one |
| General tool permissions | Not rendered into Codex TOML; `permission_default`, MCP rules, and tool specs do not generate approval tables |
| ACP session selection | Runner resolves `request.harnessMode`, defaults to `agent-full-access`, and calls `setConfigOption("mode", mode)` |
| ACP turn policy | Observed bundle sends the selected preset's approval and sandbox policies on each turn |
| Image patch | Changes full-access approval from `never` to `on-request`; leaves full-access sandbox policy intact |

Relevant source: `sdks/python/agenta/sdk/agents/adapters/codex_settings.py:116-126,
136-197`, `services/runner/src/engines/sandbox_agent/codex-mode.ts:1-35`, and
`environment.ts:1154-1160` in the same runner directory. Mode application logs a
failure and returns `undefined` rather than failing the run; its error-path unit
test passed. No live mode-setting failure was induced.

The renderer's comment at `codex_settings.py:124-126` says a file sandbox mode can
take effect with ACP `agent`. The inspected bundle nevertheless supplies an
explicit preset sandbox policy in turn construction. Do not use that comment or
a rendered-TOML test as proof of config precedence in a live `agent` session.
The authored-file-versus-session-mode matrix remains unverified.

Both runner Dockerfiles invoke the patch after pinning the adapter.
`services/runner/images/sandbox/daytona/build_snapshot.py` consumes the same JSON
anchor and checks the resulting patch at build time. This run executed the patch
unit tests and inspected the installed local bundle. It did not execute Docker
build steps or verify the remote Daytona snapshot.

## Native tools

`codex-mode.ts:1-7`, `codex-acp-patch.ts:17-21`, and the existing product gate's
`_approval_flow` at `qa_product.py:658-670` document that native shell execution
stays gate-free in default full access. `on-request` is not an instruction to ask
before every native shell operation. The patch restores native MCP approval
requests without restricting the filesystem sandbox.

The general runner policy can only decide a native operation when a harness gate
actually reaches it. Conditional on a gate with no explicit rule/spec and no
stored decision, the tested policy is:

| General setting | Runner verdict if a gate arrives | Default full-access shell evidence |
| --- | --- | --- |
| Allow | Allow without human interaction | Source says shell remains gate-free; live blocked |
| Allow reads | Allow only with `readOnlyHint: true`; otherwise Ask | Source says shell remains gate-free; live blocked |
| Ask | Pause for approval | Source says shell remains gate-free; live blocked |
| Deny | Reject | Source says shell remains gate-free; live blocked |

Consequently, neither General Deny nor a native rule is proven to prevent
default-full-access shell/file side effects. File reads through shell commands
inherit that shell path. Dedicated file-write/edit gate behavior has no fresh
live evidence in this run and should not be inferred from shell behavior alone.

The inspected adapter has distinct command-execution and file-change approval
request handlers and maps `exec_command` to an execute tool kind and `apply_patch`
to an edit kind. Handler existence does not prove that Codex raises those requests
under this preset.

### ACP identities

`acp-interactions.ts:846-898` prioritizes `rawInput.command` for a Codex execute
gate. The executed regression test at
`tests/unit/sandbox-agent-acp-interactions.test.ts:1106-1161` expects:

```json
{
  "executor": "harness",
  "toolName": "pnpm test",
  "args": {"command": "pnpm test", "cwd": "/workspace"}
}
```

Its `readOnlyHint` is undefined. Codex native exec identity is therefore not
automatically the Claude/Pi `Bash` identity. A `Bash(...)` rule must not be presented
as a verified Codex command restriction. Exact command rules still only matter
if an ACP gate arrives.

MCP identities are different again: the responder recovers the recorded MCP
name, resolves the bare tool spec, and unwraps `{server, tool, arguments}` before
matching approval arguments. Tests cover the late tool-call frame, bounded wait,
dot-form MCP server permissions, and marker discovery inside that envelope.

The tested conflict order is operator deny, explicit tool permission, server
permission, matching rules, then default. Among matching rules, Deny wins over Ask
over Allow. A stored approval does not override an effective Deny. These are
decision-function guarantees, not proof of interception for ungated native tools.

## Relay authorization

Three different checks must remain separate:

| Check | What this run establishes |
| --- | --- |
| Normal local executable-tool seam | `executable-tools.ts` consumes an existing grant if the call would otherwise Ask; an ungranted Ask parks; Deny wins over a grant |
| General file relay guard | `relay-guard.ts:91-93` returns Allow for non-Pi Ask without consuming any grant |
| Marker-commit authorization | Separate authorization checks bind marker-bearing execution to approved arguments and frozen file bytes |

`run-turn.ts:897-901` already records executable-tool grants from Claude/Codex ACP
approvals. Its local non-Pi seam uses those grants at lines 944-956. The relay guard
is independently installed for every harness at lines 958-965. Thus the comment
that non-Pi records “no grant” is not a complete description of current wiring:
the local seam has a grant handoff, but the general file relay does not consume it.

The existing `tool-relay-guard.test.ts:272-307` writes a forged Ask request into a
fresh temporary relay directory, supplies `isPi: false` with an empty grant ledger,
and observes a successful stub callback. A second request also succeeds, and a
seeded grant remains unconsumed. The non-Pi Deny test observes no callback. This is
an executed mechanism-level reproduction, not merely a source comment and not a
live customer action.

The marker tests separately prove that an unapproved forged marker request reads
no file and dispatches nothing; approved execution substitutes frozen bytes;
changed arguments or catalog identity refuse; concurrent execution consumes once;
and cold empty authorization state does not silently reuse the old approval.
Calls without markers pass through that layer, and explicit policy Allow has an
inline-resolution exception. Those protections must not be generalized to every
Ask tool or non-marker commit.

## Commands and outcomes

Directory for SDK command: `/home/mahmoud/code/agenta-2/sdks/python`.

```bash
PYTHONDONTWRITEBYTECODE=1 TMPDIR=/tmp/opencode/permission-codex-spike uv run --no-sync python -m pytest -p no:cacheprovider -o addopts='' oss/tests/pytest/unit/agents/adapters/test_codex_settings_layers.py -q
```

Outcome: 12 passed in 0.02 seconds.

Directory for runner commands: `/home/mahmoud/code/agenta-2/services/runner`.

```bash
TMPDIR=/tmp/opencode/permission-codex-spike pnpm exec vitest run --project unit --no-cache tests/unit/codex-mode.test.ts tests/unit/codex-acp-patch.test.ts tests/unit/sandbox-agent-codex-assets.test.ts tests/unit/permission-plan.test.ts tests/unit/permission-parity.test.ts tests/unit/tool-relay-guard.test.ts tests/unit/responder.test.ts tests/unit/commit-authorization.test.ts tests/unit/sandbox-agent-acp-interactions.test.ts --reporter=verbose
```

Outcome: 9 files, 224 tests passed, 1.50 seconds.

```bash
TMPDIR=/tmp/opencode/permission-codex-spike pnpm exec vitest run --project unit --no-cache tests/unit/executable-tools.test.ts tests/unit/session-keepalive-approval.test.ts tests/unit/pending-approval-pause.test.ts tests/unit/relay-loop.test.ts --reporter=verbose
```

Outcome: 4 files, 88 tests passed, 6.21 seconds. Some tests deliberately log
failed interaction requests and retries. More importantly, the lifecycle suite
also logged an attempted trace export to `cloud.agenta.ai` that received HTTP 401.
This suite was therefore not fully network-isolated despite its hermetic setup.
No customer integration was called; the export was unauthorized. Do not describe
this entire run as having zero external network attempts. No source was changed
to address that test-hygiene issue.

Read-only deployment commands, from the repository root:

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
docker inspect agenta-ee-dev-tools-api-1 agenta-ee-dev-tools-runner-1 --format '{{.Name}} image={{.Image}} mounts={{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}'
curl --max-time 15 -sS http://144.76.237.122:8780/api/health
docker inspect agenta-ee-dev-tools-api-1 agenta-ee-dev-tools-runner-1 --format '{{.Name}} started={{.State.StartedAt}} restarts={{.RestartCount}}'
```

Exact installed-bundle version/preset inspection:

```bash
docker exec agenta-ee-dev-tools-runner-1 node -e 'const fs=require("fs"),p="/root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/";for(const n of ["@agentclientprotocol/codex-acp","@openai/codex"]){const f=p+n+"/package.json";console.log(n,fs.existsSync(f)?JSON.parse(fs.readFileSync(f)).version:"absent")}const f=p+"@agentclientprotocol/codex-acp/dist/index.js";if(fs.existsSync(f)){const s=fs.readFileSync(f,"utf8");console.log(s.slice(s.indexOf("static AgentFullAccess"),s.indexOf("static AgentFullAccess")+550));}'
```

Outcome: the versions and patched preset quoted above. Additional read-only
substring inspection of that bundle found the explicit per-turn policies and
command/file approval handlers. No patch script was executed against the running
container.

Product preflight, from the SDK directory:

```bash
PYTHONDONTWRITEBYTECODE=1 TMPDIR=/tmp/opencode/permission-codex-spike uv run --no-sync --active /tmp/opencode/permission-codex-spike/run_gate.py
```

The isolated script imports `api/oss/tests/pytest/utils/accounts.py`, reads the
selected API container's admin credential into memory without printing it, calls
the fixture once, and passes the returned project key to the existing gate in the
child environment. It explicitly supplies all three `AGENTA_*` gate variables and
uses a nonexistent isolated `--env-file` to prevent fallback to another project.
It invokes the existing script with these exact arguments:

```text
qa_product.py --cell X1 --only chat --env-file /tmp/opencode/permission-codex-spike/no-fallback.env
```

Outcome: account creation HTTP 200; product request HTTP 422. The gate's
`results.json` contains `pass: false`, no frames, no tools, and this error:

```text
provider 'openai' connection has no usable credential; configure a credential or select self_managed authentication
```

The isolated project ID is `01a07d0c-6386-7071-a670-7fa11e0753ce`; the failed session
ID is `106e33af-5fd7-49fc-9873-310ef64ab069`. These identify only this gate account.
Credentials were not written into the report or scratch files.

Artifacts:

```text
/tmp/opencode/permission-codex-spike/run_gate.py
/tmp/opencode/permission-codex-spike/gate-runs/20260907-200559/results.json
/tmp/opencode/permission-codex-spike/gate-runs/20260907-200559/summary.md
```

## Recommendation

1. Keep the existing Codex full-access/on-request preset in this default-change
   slice. Do not replace it with `never` to remove approvals: that would remove
   the ACP approval path relied on for explicit platform Ask.
2. Do not promise that General Ask/Deny controls every native shell or file edit.
   Establish actual gate coverage before exposing that as a safety guarantee.
   Avoid treating `Bash` rules or rendered `sandbox_mode` as equivalent controls.
3. Plan general non-Pi relay grant enforcement as a separate security change.
   Reuse the existing executable-grant handoff, but assign consumption to the
   execution boundary deliberately so the local seam and relay do not consume the
   same grant twice. Preserve marker authorization as a separate check. Verify
   local and Daytona, normal calls and forged requests, exact and changed args,
   duplicates, warm resume, and cold reconstruction before landing it.
4. Resume this live spike only with a funded OpenAI credential provisioned for an
   isolated gate project, or an already-configured Codex subscription deployment.
   Start with `X1/chat`, then existing `tool`, `approve`, `deny`, `warm`, and
   `cold1` journeys. Require store evidence for continuity. The existing Codex
   `mount` journey skips because its output extraction cannot see Codex results;
   it cannot verify native file editing. Add approved repository gate coverage
   for the four-default native shell/read/write/edit matrix rather than claiming
   the MCP approval journey covers it.

Cold runner replacement was intentionally not attempted under the no-restart
constraint. The older
[warm approval report](../codex-harness/reports/warm-approvals-qa.md) provides
historical local/Daytona results, but none were counted as fresh passes here.
