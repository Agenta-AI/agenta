# QA findings

Defects and surprises found while running the agent-workflows QA matrix. Same format as
`../open-issues.md`: each entry carries enough context and provenance to fix cold. A fixer
should not need this session.

Ids are `F-NNN`. Severity is `blocker`, `major`, `minor`, or `docs`. Triage is one of
`fix-now`, `defer`, or `escalate` (see `README.md`). When an entry is fixed, set status to
`resolved` with the date and the PR or commit.

## Findings

### F-001 Pi system-prompt overrides are silently dropped on the Rivet ACP path

**Status:** open
**Severity:** major
**Triage:** fix-now (candidate; confirm the home of the fix is the rivet engine wire path)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** E2 Rivet local and E3 Rivet Daytona, harness `pi`, capability system-prompt
override (`harness_options.pi.append_system` / `system`)
**Source:** prior `feature-matrix-test.md` live run; matches the gap noted in
`ground-truth.md` ("Pi systemPrompt and appendSystemPrompt are not delivered on the rivet ACP
path")

**The problem.** With `harness_options.pi.append_system` set to inject a token, the
in-process Pi backend (E1) includes the token in the model's behavior and the Rivet backend
(E2, E3) does not, in both local and Daytona. The override has no effect on Rivet. It fails
quietly: the run still returns HTTP 200 with a normal reply, the injected instruction is just
absent. So a user who sets a Pi system-prompt layer and runs on Rivet gets a silent no-op,
which is worse than an error because nothing signals the loss.

**Why it matters.** `system` and `append_system` are the documented Pi knobs for shaping the
agent's behavior beyond `agents_md`. Dropping them on Rivet means the same config behaves
differently on two backends that are supposed to be interchangeable for the `pi` harness.

**What to decide or do.** Trace where `systemPrompt` and `appendSystemPrompt` leave the wire
payload and where the Rivet engine should pass them into the ACP session for Pi. The
in-process path (`services/agent/src/engines/pi.ts`) already honors them; the Rivet path
(`services/agent/src/engines/rivet.ts`) does not thread them to the Pi ACP agent. Confirm
whether ACP for Pi exposes a system-prompt channel at all. If it does, wire it. If it does
not, the fix is to surface a clear error or warning rather than drop silently, and document
the limitation. Add the `append_system` Gherkin scenario as the regression guard once fixed.

### F-002 ground-truth.md says AgentaHarness does not run on Rivet, but it does

**Status:** open
**Severity:** docs
**Triage:** fix-now
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** doc review against code and the prior live run
**Source:** comparing `ground-truth.md` "Not Implemented" against `feature-matrix-test.md`
results and `sdks/python/agenta/sdk/agents/adapters/rivet.py`

**The problem.** `ground-truth.md` lists "AgentaHarness does not run on rivet or Daytona"
under Not Implemented, and `status.md` repeats "AgentaHarness still uses placeholder product
content and only works on the in-process Pi path." But `RivetBackend.supported_harnesses`
includes `AGENTA`, and the prior live matrix run shows the agenta harness passing on Rivet
local and Daytona for chat, instructions, model override, forced tools, and forced skills.
The docs and the code disagree. A reader trusting the docs would skip a path that works.

**Why it matters.** `ground-truth.md` is declared the source of truth for active-stack
behavior. A stale "Not Implemented" line there sends fixers and testers the wrong way.

**What to decide or do.** Verify agenta-on-Rivet during the QA run (it should pass). Then
correct `ground-truth.md` and `status.md` to say AgentaHarness runs on Rivet local and
Daytona, keeping any genuinely accurate caveat (for example placeholder preamble or persona
content, if that is still true). Keep the edit narrow and code-backed.

### F-003 No author-facing way to add a custom skill (with or without code)

**Status:** open
**Severity:** major
**Triage:** escalate (product surface: needs a config field and a delivery decision)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** code review of the skill wiring while planning the skills cells
**Source:** reading `sdks/python/agenta/sdk/agents/adapters/harnesses.py:107-123`,
`agenta_builtins.py:58`, and `dtos.py` (neutral `AgentConfig` has no `skills` field)

**The problem.** Skills are entirely hardcoded. `AgentaHarness._to_harness_config` sets
`skills=list(AGENTA_FORCED_SKILLS)`, and `AGENTA_FORCED_SKILLS` is the single placeholder
`["agenta-getting-started"]`. The neutral `AgentConfig` exposes no `skills` field, the
playground default config in `schemas.py` has none, and any `skills` a caller might send is
ignored. So an agent author cannot ship their own skill, with code or without. The only skill
that ever loads is the bundled placeholder. The runner is fully capable of more (it resolves
named dirs and copies them recursively, scripts included), but nothing upstream lets a user
name one.

**Why it matters.** "Skills with code" and "custom skills" are headline capabilities of this
feature, but today they are not reachable by a user. The capability exists in the runner and
dies at the config layer.

**What to decide or do.** Decide the author-facing skill contract. Options: (1) add a `skills`
list to the neutral `AgentConfig` that carries bundled skill names, unioned with the forced
set; (2) let an author upload a skill bundle (SKILL.md plus scripts) that the service stores
and the runner installs; (3) keep skills platform-curated only and drop the capability from
the matrix. This is a product decision plus a delivery mechanism, so it is escalated rather
than fixed in place. The runner mechanism is verified working (see F-005 retest): a script
laid into a loaded skill dir runs end to end.

### F-004 Claude harness: key resolves and auth works, blocked only on Anthropic account credit

**Status:** resolved-with-residual (2026-06-20). The "no key" reading was wrong. The residual
blocker is Anthropic account credit, which is billing, not code.
**Severity:** environmental (no code defect)
**Triage:** none (top up the Anthropic account to finish the Claude and MCP rows)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** harness `claude` on Rivet, run against the `pi-agents` project
**Source:** corrected by driving the UI after the initial API scan misread the project

**The problem and the correction.** The first pass concluded no project had an Anthropic key,
because the vault scan reused one API key with a `?project_id=` override. The vault
`list_secrets` route keys off the API key's **bound** project (`request.state.project_id`),
not the query param, so it kept returning the same project's secrets. The UI showed the truth:
the **`pi-agents`** project (`019ecbaf-5f3f-7d12-9aef-f49272dfd82e`) has an `anthropic`
provider key, plus live Composio connections for github, figma, and slackbot. Running Claude
with that project's **own** API key authenticates: the error moves from "model authentication
failed" to `claude: the model provider account has insufficient credit (check the project's
Anthropic key)`. So the harness wiring, key resolution, and auth all work end to end. The
Anthropic account just has no credit.

**Lesson (worth a small follow-up).** To test a capability that reads the project vault
(provider keys, tool connections), use that **project's own API key**. A cross-project key
silently resolves the wrong project's secrets on the vault and connections routes, even though
`/invoke` itself honors `?project_id`. That inconsistency is a minor UX trap that cost a wrong
conclusion here.

**What to do.** Top up the Anthropic account behind the `pi-agents` key, then re-run the Claude
rows and the Claude-borne MCP scenario with the `pi-agents` API key. No code change.

### F-005 Dev agent-pi ships a stale Pi extension bundle, silently breaking custom tools on Rivet

**Status:** fix applied (compose `command:` + Dockerfile.dev), reviewed, pending container rebuild
**Severity:** major
**Triage:** fix-now (done in working tree; live container hot-patched)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** E2 Rivet local and E3 Daytona, harness `pi` and `agenta`, capability code tools
**Source:** QA run `code_tool_pi` / `code_tool_agenta` failed; root-caused live

**The problem.** Custom `code` tools (python and node) were not delivered to the model on the
Pi-over-Rivet path. The model never saw the tool, so it improvised by running the tool name as
a shell command and returned `command not found`. Root cause: the runner advertises custom
tools to Pi through the Agenta Pi extension via `AGENTA_TOOL_PUBLIC_SPECS`
(`services/agent/src/extensions/agenta.ts:38-75`, `registerTools`). The `agent-pi` dev image
bakes the extension bundle at build time (`Dockerfile.dev: RUN pnpm run build:extension`) and
bind-mounts only `src`, not `dist`. The extension source was edited (commit `2c2bac7519`
"relay child tools") after the running image was built, so the baked bundle predates
`registerTools`: it contained `AGENTA_TOOL_RELAY_DIR` but not `AGENTA_TOOL_PUBLIC_SPECS`. The
`tsx watch` mount hot-reloads the runner but never rebuilds the extension, and nothing signals
the staleness.

**Repro.** Send `POST /invoke` (harness `pi`, sandbox `local`) with a `code` tool named
`secret_node` (runtime node) returning a constant, and ask the agent to call it. Before the
fix the reply is `command secret_node was not found`. After rebuilding the bundle inside the
container (`node scripts/build-extension.mjs`) the reply is the tool's constant.

**The fix.** Rebuild the extension bundle from the mounted source on container start, so a
restart picks up edited extension source without a full image rebuild. A reviewer caught that
the dev `agent-pi` compose service overrides the image CMD with its own `command:`
(`hosting/docker-compose/ee/docker-compose.dev.yml:435-437`), so a Dockerfile CMD edit alone is
inert on the deployed stack. The rebuild now lives in that compose `command:` (runs
`node scripts/build-extension.mjs` before `exec ... tsx src/server.ts`), with the Dockerfile.dev
CMD updated too for the bare `docker run` case. The live container was hot-patched for this
session by running the build inside it; that patch is ephemeral and lost on restart. Retest
after a container rebuild: `code_tool_pi` and `code_tool_agenta` should pass on E2 and E3.

### F-006 Code tools with runtime "python" fail on the runner: no python3 in the agent image

**Status:** fix applied (both Dockerfiles), pending review + image rebuild
**Severity:** major (affects production, not just dev)
**Triage:** fix-now (done in working tree; live container hot-patched)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** E2 Rivet local, harness `pi`, capability code tool (python runtime)
**Source:** QA run; isolated after fixing F-005 (the python tool then failed with
`spawn python3 ENOENT` while the node tool passed)

**The problem.** A `code` tool with `runtime: "python"` is executed by the runner relaying the
call and spawning `python3` (`services/agent/src/tools/code.ts:128`). The `agent-pi` image
(both `docker/Dockerfile` and `docker/Dockerfile.dev`) installs only `ca-certificates git`, no
`python3`. So every python code tool fails with `spawn python3 ENOENT`, surfaced to the model
as the tool result. Node code tools are unaffected (node is the runtime). This affects
production, not only dev, because both images omit python3 and code tools execute in the
runner regardless of sandbox.

**Repro.** Same as F-005 but with a python `code` tool. After F-005 is fixed the reply is
`spawn python3 ENOENT`. Installing python3 in the runner makes it return the tool's value.

**The fix.** Add `python3` to the apt install in `services/agent/docker/Dockerfile` and
`Dockerfile.dev`. Validated live by `apt-get install -y python3` in the container, after which
the python code tool returned its computed value `QA-CODE-OK-43`. Retest after the image
rebuild.

### F-007 Per-request model override is rejected on the Pi-over-Rivet ACP path

**Status:** open (confirmed; impact understood)
**Severity:** major (a user silently gets a different, often pricier, model)
**Triage:** defer (decide: validate against the allowed set, or fail loud)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** Rivet local, harness `pi` and `claude`, capability model override
**Source:** sidecar logs across several runs

**The problem.** The Rivet ACP session only accepts a fixed, harness-specific set of model
values for the `model` config category, and silently falls back to the harness default for
anything else (`applyModel`, `rivet.ts:961`). What the set is depends on the harness:

- **pi**: allowed values are just `default`. Any model id (`gpt-5.5`, `gpt-4o-mini`) is
  rejected and dropped. So the pi-over-Rivet path effectively cannot pick a model.
- **claude**: allowed values are `default, sonnet[1m], opus[1m], haiku`. The aliases work
  (`model: "haiku"` was applied, verified by the absence of a "not settable" warning and by
  cost), but a full id like `claude-haiku-4-5-20251001` is rejected and falls back to the
  default (Sonnet), which is the expensive model. So a caller who passes a real model id, the
  way every other Agenta surface expects, silently gets the default.

This is the cost trap: testing with `model: "claude-haiku-4-5-20251001"` actually billed
Sonnet until the alias `haiku` was used. The run always succeeds, so the drop is invisible.

**Why it matters.** A user who picks a model and runs on Rivet may silently get a different
model. Two backends that are meant to be interchangeable for the `pi` harness diverge.

**What to decide or do.** Confirm whether any non-default model is accepted by pi-acp. If not,
decide whether to make the override an error on Rivet (fail loud) or to document Rivet as
default-model-only and constrain the UI. Capture as a regression scenario once decided.

### F-008 A skill that ships a helper script cannot run it via a relative path

**Status:** open
**Severity:** major (blocks "skills with code" from the model's view)
**Triage:** defer (needs the skill-path contract decided; small once decided)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** E2 Rivet local, harness `agenta`, capability skills with code
**Source:** QA run; provisioned a `scripts/daily_code.py` into the loaded skill and asked for
its output

**The problem.** The runner copies a skill's whole directory, scripts included, into Pi's
agent skills dir, and the script runs correctly: when the agent is told to `find` the file and
run it, it returns the script's unguessable token (`QA-SKILL-CODE-32bb25c6`). But when the
SKILL.md says `run scripts/daily_code.py` (a relative path, the normal skill-authoring
convention), the model resolves it against the run CWD (`/tmp/agenta-rivet-XXesc/scripts/`),
not the skill's install directory, and reports the script "does not exist." The model is never
told the skill's absolute location, so a relative script reference in SKILL.md does not
resolve. The infra works end to end; the path contract does not.

**Repro.** Add `scripts/foo.py` to a loaded skill and a SKILL.md line "run `scripts/foo.py`".
Ask the agent to follow it. It looks under the run CWD and fails. Ask it to `find` the script
first and it runs fine.

**What to decide or do.** Decide how a skill references its own assets. Options: (1) surface
the skill's absolute install path to the model when Pi renders the skill (then SKILL.md can
say `run <skill_dir>/scripts/foo.py` or the model prepends it); (2) install skills into a
stable, documented root the SKILL.md can hard-reference; (3) document a convention that
scripts are found relative to the skill, and have Pi pass that base. Verify what Pi already
exposes about skill location before choosing. The fix is small once the contract is set.

### F-009 MCP works on Claude; it is Claude-only (pi/agenta silently drop mcp_servers)

**Status:** verified working (2026-06-20). MCP passes on Claude. The residual is the pi/agenta
mismatch below.
**Severity:** minor (the residual is a UX mismatch, not a broken capability)
**Triage:** defer (decide whether to hide `mcp_servers` for pi/agenta)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** Claude harness on Rivet local, `pi-agents` project, MCP flag on
**Source:** `services/agent/src/engines/rivet.ts:933-949` and a live MCP run

**Verified.** With `AGENTA_AGENT_ENABLE_MCP=true` and Anthropic credit, a Claude run with a
stdio `mcp_servers` entry (`node qa/scripts/mcp_qa_server.mjs`, exposing `get_secret_record`)
invoked the tool and returned the unguessable record `MCP-RECORD-X9F2`. So MCP delivery and
invocation work end to end on Claude. The minimal hand-rolled server lives at
`qa/scripts/mcp_qa_server.mjs`.

**The residual.** MCP is delivered only on the non-Pi branch
(`if (!isPi && capabilities.mcpTools)`); in-process Pi reports `mcpTools: false` and pi-acp
does not forward MCP. So MCP reaches only Claude. The config surface exposes `mcp_servers` for
every harness, but pi and agenta silently drop them.

**What to decide or do.** Decide whether to hide or warn on `mcp_servers` when the selected
harness is pi/agenta, since today they accept the field and ignore it. The flag also gates only
user-declared servers: tool-delivery MCP for Claude (code/gateway tools over the synthesized
`agenta-tools` server) works without the flag, as the Claude code-tool run confirmed.

### F-010 Code tools execute in the trusted runner with no sandboxing

**Status:** open
**Severity:** major (security)
**Triage:** escalate (security surface; needs a design decision)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** code review during the F-006 fix
**Source:** reviewer subagent on the runner Dockerfile fixes; `services/agent/src/tools/code.ts`

**The problem.** A `code` tool's author-supplied snippet runs in the runner process (the
`agent-pi` sidecar), not inside the Daytona sandbox, for every sandbox axis: in-process Pi via
`tools/dispatch.ts:110` and Rivet local and Daytona via `tools/relay.ts:101`, both landing in
`runCodeTool` (`code.ts`). The env is allowlisted well: `BASE_ENV_ALLOWLIST` copies only
PATH/HOME/locale/temp, `buildChildEnv` adds only the tool's scoped secrets, and there is a
per-call SIGKILL timeout and a temp-dir-only working directory. But the snippet still runs
with the runner's full OS privileges and unrestricted network. The env allowlist stops secret
exfiltration through env vars, not arbitrary outbound network, filesystem reads outside the
temp dir (PATH and HOME are real), or process introspection. Adding `python3` (F-006), a far
more capable runtime than the node bootstrap, widens this surface.

**Why it matters.** An agent author's code tool is effectively arbitrary code execution on the
shared runner. On a multi-tenant deployment that is a real isolation concern.

**What to decide or do.** Decide where code tools should run: inside the Daytona sandbox
(strong isolation, but only for the daytona axis), or in a locked-down subprocess on the
runner (nsjail or seccomp plus a network-deny default). This is out of scope for the QA fixes
and needs a security design decision.

### F-011 Cannot create a connection for a no-auth Composio toolkit

**Status:** open
**Severity:** major (blocks the only no-OAuth path to test gateway tools)
**Triage:** defer (real bug in the tools API, separate subsystem from agent-workflows)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** trying to set up a Composio gateway tool to test the gateway capability
**Source:** `POST /api/tools/connections/` with `integration_key=codeinterpreter` returns 500

**The problem.** To test gateway tools without an interactive OAuth flow, the obvious path is a
no-auth Composio toolkit (`codeinterpreter` and `composio` both report `auth: null` in the
catalog). But creating a connection for one fails. The adapter
(`api/oss/src/core/tools/providers/composio/adapter.py:225-240`) always POSTs an auth config:
for `auth_scheme=None` it sends `{"type":"use_composio_managed_auth"}`. Composio rejects this
with 400 `Auth_Config_NoAuthApp`: "Cannot create an auth config for toolkit 'codeinterpreter'
because it does not require authentication... use its tools directly without creating a
connected account." The 400 surfaces as a 500 to the caller. So a no-auth toolkit can never be
connected, and since the gateway tool config requires a `connection` slug, no-auth gateway
tools cannot be configured at all.

**Why it matters.** It is the only way to exercise the gateway capability end to end without a
human authorizing an OAuth app (github, gmail, ...). It also means a whole class of useful
Composio tools (code interpreter, web search helpers) is unreachable.

**What to decide or do.** In the adapter, detect a no-auth toolkit (auth_scheme None plus the
catalog's no-auth signal) and skip auth-config creation: either create the connected account
without an auth config per Composio's no-auth flow, or model a no-auth "connection" in Agenta
that resolution and execution can use directly. Then a `codeinterpreter` gateway tool can be
configured and the gateway path tested with no OAuth.

## How to add a finding during a run

Copy the F-001 block, bump the id, and fill every field. Required: the environment, harness,
and capability the defect showed up in; the exact repro (the request body or the script and
the message sent); what you expected and what you got; and the triage call with one line of
why. If you cannot write a clean repro, the finding is not ready to hand off. Capture the
raw request and response under `qa/runs/` and link it.
