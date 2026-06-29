# QA findings

Defects and surprises found while running the agent-workflows QA matrix. Same format as
`../open-issues.md`: each entry carries enough context and provenance to fix cold. A fixer
should not need this session.

Ids are `F-NNN`. Severity is `blocker`, `major`, `minor`, or `docs`. Triage is one of
`fix-now`, `defer`, or `escalate` (see `README.md`). When an entry is fixed, set status to
`resolved` with the date and the PR or commit.

## Findings

### F-001 Pi system-prompt overrides are silently dropped on the sandbox-agent ACP path

**Status:** resolved (2026-06-20, main-workspace `sandbox_agent.ts`; pending port to PR #4778 +
reviewer). Fix: the sandbox-agent engine now writes `SYSTEM.md`/`APPEND_SYSTEM.md` into the per-run Pi
agent dir (Pi reads them from the agent dir with no trust gate, the filesystem analogue of the
in-process loader override). `system` replaces, `append_system` extends; written only into the
throwaway per-run dir so it never leaks into later runs; Daytona wired via the sandbox FS API.
Verified live: the injected token now appears on sandbox-agent. typecheck clean, 60/60 runner tests.
Reviewer APPROVED (leak-safety, replace/append semantics vs Pi source, Daytona path, no
regression all confirmed). Port to PR #4778 as just the system-prompt delta.
**Severity:** major
**Triage:** done
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local and E3 sandbox-agent Daytona, harness `pi`, capability system-prompt
override (`harness_options.pi.append_system` / `system`)
**Source:** prior `feature-matrix-test.md` live run; matches the gap noted in
`ground-truth.md` ("Pi systemPrompt and appendSystemPrompt are not delivered on the sandbox-agent ACP
path")

**The problem.** With `harness_options.pi.append_system` set to inject a token, the
in-process Pi backend (E1) includes the token in the model's behavior and the sandbox-agent backend
(E2, E3) does not, in both local and Daytona. The override has no effect on sandbox-agent. It fails
quietly: the run still returns HTTP 200 with a normal reply, the injected instruction is just
absent. So a user who sets a Pi system-prompt layer and runs on sandbox-agent gets a silent no-op,
which is worse than an error because nothing signals the loss.

**Why it matters.** `system` and `append_system` are the documented Pi knobs for shaping the
agent's behavior beyond `agents_md`. Dropping them on sandbox-agent means the same config behaves
differently on two backends that are supposed to be interchangeable for the `pi` harness.

**What to decide or do.** Trace where `systemPrompt` and `appendSystemPrompt` leave the wire
payload and where the sandbox-agent engine should pass them into the ACP session for Pi. The
in-process path (`services/agent/src/engines/pi.ts`) already honors them; the sandbox-agent path
(`services/agent/src/engines/sandbox_agent.ts`) does not thread them to the Pi ACP agent. Confirm
whether ACP for Pi exposes a system-prompt channel at all. If it does, wire it. If it does
not, the fix is to surface a clear error or warning rather than drop silently, and document
the limitation. Add the `append_system` Gherkin scenario as the regression guard once fixed.

### F-002 ground-truth.md says AgentaHarness does not run on sandbox-agent, but it does

**Status:** open
**Severity:** docs
**Triage:** fix-now
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** doc review against code and the prior live run
**Source:** comparing `ground-truth.md` "Not Implemented" against `feature-matrix-test.md`
results and `sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py`

**The problem.** `ground-truth.md` lists "AgentaHarness does not run on sandbox-agent or Daytona"
under Not Implemented, and `status.md` repeats "AgentaHarness still uses placeholder product
content and only works on the in-process Pi path." But `SandboxAgentBackend.supported_harnesses`
includes `AGENTA`, and the prior live matrix run shows the agenta harness passing on sandbox-agent
local and Daytona for chat, instructions, model override, forced tools, and forced skills.
The docs and the code disagree. A reader trusting the docs would skip a path that works.

**Why it matters.** `ground-truth.md` is declared the source of truth for active-stack
behavior. A stale "Not Implemented" line there sends fixers and testers the wrong way.

**What to decide or do.** Verify agenta-on-sandbox-agent during the QA run (it should pass). Then
correct `ground-truth.md` and `status.md` to say AgentaHarness runs on sandbox-agent local and
Daytona, keeping any genuinely accurate caveat (for example placeholder preamble or persona
content, if that is still true). Keep the edit narrow and code-backed.

### F-003 No author-facing way to add a custom skill (with or without code)

**Status:** resolved (2026-06-24, skills-config). The neutral config now carries an
author-supplied `SkillConfig` in the `skills` field, inline or via `@ag.embed`; the runner
materializes it for Pi. Verified live by the skill-invocation scenario (see `matrix.md`,
"Live run results — skill invocation"): the `weather-oracle` skill, supplied by the author
both inline and by embed reference, was surfaced and invoked (token `SKILL-LOADED-7Q42-OK`).
Residuals tracked separately: F-014 (embed reference shape), F-015 (silent drop on Claude).
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
**Found in:** harness `claude` on sandbox-agent, run against the `pi-agents` project
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

### F-005 Dev sandbox-agent ships a stale Pi extension bundle, silently breaking custom tools on sandbox-agent

**Status:** fix applied (compose `command:` + Dockerfile.dev), reviewed, pending container rebuild
**Severity:** major
**Triage:** fix-now (done in working tree; live container hot-patched)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local and E3 Daytona, harness `pi` and `agenta`, capability code tools
**Source:** QA run `code_tool_pi` / `code_tool_agenta` failed; root-caused live

**The problem.** Custom `code` tools (python and node) were not delivered to the model on the
Pi-over-sandbox-agent path. The model never saw the tool, so it improvised by running the tool name as
a shell command and returned `command not found`. Root cause: the runner advertises custom
tools to Pi through the Agenta Pi extension via `AGENTA_TOOL_PUBLIC_SPECS`
(`services/agent/src/extensions/agenta.ts:38-75`, `registerTools`). The `sandbox-agent` dev image
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
the dev `sandbox-agent` compose service overrides the image CMD with its own `command:`
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
**Found in:** E2 sandbox-agent local, harness `pi`, capability code tool (python runtime)
**Source:** QA run; isolated after fixing F-005 (the python tool then failed with
`spawn python3 ENOENT` while the node tool passed)

**The problem.** A `code` tool with `runtime: "python"` is executed by the runner relaying the
call and spawning `python3` (`services/agent/src/tools/code.ts:128`). The `sandbox-agent` image
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

### F-007 Per-request model override is rejected on the Pi-over-sandbox-agent ACP path

**Status:** open (confirmed; impact understood)
**Severity:** major (a user silently gets a different, often pricier, model)
**Triage:** defer (decide: validate against the allowed set, or fail loud)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** sandbox-agent local, harness `pi` and `claude`, capability model override
**Source:** sidecar logs across several runs

**The problem.** The sandbox-agent ACP session only accepts a fixed, harness-specific set of model
values for the `model` config category, and silently falls back to the harness default for
anything else (`applyModel`, `sandbox_agent.ts:961`). What the set is depends on the harness:

- **pi**: allowed values are just `default`. Any model id (`gpt-5.5`, `gpt-4o-mini`) is
  rejected and dropped. So the pi-over-sandbox-agent path effectively cannot pick a model.
- **claude**: allowed values are `default, sonnet[1m], opus[1m], haiku`. The aliases work
  (`model: "haiku"` was applied, verified by the absence of a "not settable" warning and by
  cost), but a full id like `claude-haiku-4-5-20251001` is rejected and falls back to the
  default (Sonnet), which is the expensive model. So a caller who passes a real model id, the
  way every other Agenta surface expects, silently gets the default.

This is the cost trap: testing with `model: "claude-haiku-4-5-20251001"` actually billed
Sonnet until the alias `haiku` was used. The run always succeeds, so the drop is invisible.

**Why it matters.** A user who picks a model and runs on sandbox-agent may silently get a different
model. Two backends that are meant to be interchangeable for the `pi` harness diverge.

**What to decide or do.** Confirm whether any non-default model is accepted by pi-acp. If not,
decide whether to make the override an error on sandbox-agent (fail loud) or to document sandbox-agent as
default-model-only and constrain the UI. Capture as a regression scenario once decided.

### F-008 A skill that ships a helper script cannot run it via a relative path

**Status:** downgraded to verify-only (2026-06-20). The Codex review of the skills proposal
found Pi 0.79.4 already emits the skill's `<location>` plus a relative-path resolution
instruction in the prompt, so a relative `scripts/foo.py` should resolve. The original repro
likely failed for another reason (the model not reading the skill, see the no-code test). This
is now "re-run the with-code skill test and confirm" rather than a guaranteed bug. Tracked
under the skills proposal (`docs/design/agent-workflows/skills-config/`).
**Severity:** minor (verify; likely already handled by Pi)
**Triage:** verify (re-test; fix only if it actually fails)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, harness `agenta`, capability skills with code
**Source:** QA run; provisioned a `scripts/daily_code.py` into the loaded skill and asked for
its output

**The problem.** The runner copies a skill's whole directory, scripts included, into Pi's
agent skills dir, and the script runs correctly: when the agent is told to `find` the file and
run it, it returns the script's unguessable token (`QA-SKILL-CODE-32bb25c6`). But when the
SKILL.md says `run scripts/daily_code.py` (a relative path, the normal skill-authoring
convention), the model resolves it against the run CWD (`/tmp/agenta-sandbox-agent-XXesc/scripts/`),
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
**Found in:** Claude harness on sandbox-agent local, `pi-agents` project, MCP flag on
**Source:** `services/agent/src/engines/sandbox_agent.ts:933-949` and a live MCP run

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
`sandbox-agent` sidecar), not inside the Daytona sandbox, for every sandbox axis: in-process Pi via
`tools/dispatch.ts:110` and sandbox-agent local and Daytona via `tools/relay.ts:101`, both landing in
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

**Status:** shipped as PR #4785 (2026-06-21), based on `feat/agent-service` (the gateway
tool-resolution API, not yet in main). Root cause: the adapter always POSTs an auth config,
which Composio 400s for a no-auth toolkit, and resolve/execute also required a connected-account
id no-auth toolkits do not have. Fix: detect a no-auth toolkit, persist a usable connection with
no Composio account, omit the account id on resolve/execute, and make connection validity
server-owned (a client can no longer send `flags.is_valid`). Subagent-found, reviewed by a
second subagent and Codex (their one blocker, client-settable `is_valid`, is fixed), 15/15 tools
tests pass, ruff clean. Verified live: create 500 to 200, resolve 200, `/tools/call` ran
`print(6*7)` and returned `42`.
**Severity:** major (blocks the only no-OAuth path to test gateway tools)
**Triage:** done
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

### F-012 Together AI vault key never reaches the harness (wrong env var name)

**Status:** open
**Severity:** minor (one provider) but a real silent-drop
**Triage:** fix-now (one line)
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** Codex review of the model-config (F-007) proposal
**Source:** `services/oss/src/agent/secrets.py` (the `_PROVIDER_ENV_VARS` map)

**The problem.** `resolve_harness_secrets` maps the vault provider kind `together_ai` to the
env var `TOGETHERAI_API_KEY`, but Pi and litellm read `TOGETHER_API_KEY`. So a Together AI key
configured in the project vault is injected under a name the harness never reads, and Together
models silently fall back, the same silent-drop class as F-007.

**What to do.** Change the mapping to `TOGETHER_API_KEY`. While there, verify the `mistralai`,
`groq`, and `openrouter` env var names against what Pi/litellm actually read, since the same
typo class could hide there. One-line fix per provider.

### F-013 Rename the runner to `sandbox-agent`

**Status:** fixed
**Severity:** clarity (naming) but a real source of confusion
**Triage:** fixed by sidecar deployment proposal implementation
**Added:** 2026-06-20
**Commit:** 80cda5aae8 (branch `gitbutler/workspace`)
**Found in:** reviewing the code-tool-sandbox explainer with the product owner
**Source:** `hosting/docker-compose/ee/docker-compose.dev.yml`, service env naming

**The problem.** The runner used Pi-specific service/env naming even though it is
harness-agnostic: it drives Pi today, Claude Code and other harnesses next. The old names
wrongly implied the issue was Pi-specific when the issue was in the shared runner.

**Resolution.** The deployable service is now `sandbox-agent`, and the services container
uses `AGENTA_AGENT_RUNNER_URL` for the service-to-runner URL. Runner provider settings moved
to `SANDBOX_AGENT_*` env vars on the runner service.

### F-014 Skill embed via `workflow_revision` bare slug 500s; reference at the artifact level

**Status:** resolved (2026-06-24). Fixed by referencing skills at the artifact level
(`@ag.references{workflow.slug}`, latest revision) in the seeded default config and the
proposal docs; a no-version bare-slug fallback in the shared embed resolver is the deferred
option (logged, not done — to avoid blast radius on shared embed resolution).
**Severity:** major (the seeded default skill never loaded; documented pattern was broken)
**Triage:** fix-now (done) + defer (optional resolver fallback)
**Added:** 2026-06-24
**Commit:** 670491fee0 (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, harness `agenta`, capability skill invocation (embed
variant), trigger `What's the weather like today?`
**Source:** live E2E run, `skills-config/build-notes.md`; root-caused in
`api/oss/src/core/embeds/utils.py` (`_resolve_revision_with_normalization`) and
`services/oss/src/agent/schemas.py` (the seeded `_DEFAULT_AGENT_CONFIG`)

**The problem.** Embedding a skill with a `workflow_revision` reference that carries a bare
artifact slug and no version returns HTTP 500 deterministically (~0.02s, not the LLM):

```text
oss.src.core.embeds.exceptions.EmbedNotFoundError: Referenced entity not found:
  Workflow revision not found: version=None slug='weather-oracle-e2e' id=None
```

A `workflow_revision` slug is matched against the revision's **own** slug, which is a content
hash (`6ab8cf001ea2`), not the author-facing artifact slug (`weather-oracle-e2e`).
`_resolve_revision_with_normalization` only normalizes a slug to a revision when a `version`
is also supplied (both normalization branches require `ref.version`). With a bare `{slug}` and
no version, nothing matches and it raises `EmbedNotFoundError`, surfaced as a 500 from
`/api/workflows/revisions/resolve`.

**Why it matters.** The seeded `_DEFAULT_AGENT_CONFIG` referenced its default skill via
`{"workflow_revision": {"slug": "agenta-getting-started"}}`, the exact broken shape, so the
default agent's forced skill never loaded (confirmed live, HTTP 500). The proposal documented
the same no-version pattern. The artifact-level reference resolves cleanly:
`@ag.references{workflow.slug}` resolves to the latest revision and the token appeared in the
reply (Test 2, embed variant — PASS).

**Repro.** `POST /services/agent/v0/invoke` with a skill embed
`{"@ag.embed":{"@ag.references":{"workflow_revision":{"slug":"weather-oracle-e2e"}},"@ag.selector":{"path":"parameters.skill"}}}`
(no version) returns 500. The same embed with `{"workflow":{"slug":"weather-oracle-e2e"}}`
returns 200 and the skill loads. Payloads: `req_test2_embed.json` (fails),
`req_test2_default.json` (seeded default, fails), `req_test2_artifact.json` (passes).

**What was done.** Referenced skills at the artifact level in the seeded default and docs;
version pinning stays available via `{"workflow_revision": {"slug", "version"}}`. Deferred: an
optional no-version bare-slug to latest-revision fallback in the shared embed resolver, left
out to avoid changing shared embed resolution for a case the artifact-level reference already
covers.

### F-015 Claude harness drops skills silently (no warning) on the non-Pi path

**Status:** resolved (2026-06-24, warning added at the adapter boundary). Was: the drop
happened with no log line at all.
**Severity:** minor (observability; the drop itself is by design)
**Triage:** fix-now (done)
**Added:** 2026-06-24
**Commit:** 670491fee0 (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, harness `claude`, capability skill invocation
**Source:** `services/agent/src/engines/sandbox_agent/run-plan.ts:165`
(`const { skills } = isPi ? resolveSkillDirs(...) : { skills: [], cleanup: noop }`); confirmed
live by timestamps (the Claude run carried no `[sandbox-agent] skills:` log line)

**The problem.** The runner materializes skills only for Pi. For a non-Pi acpAgent (Claude),
skills are dropped by design — the Claude SDK path cannot load a `SKILL.md`. That part is
correct. But the drop happened with **no warning logged**, so a user who configures skills and
selects Claude gets a silent no-op (the same silent-drop class as F-001/F-007/F-012). The
Claude run here also failed at session creation on a missing `anthropic` provider key (no
`anthropic` key in the resolving project), so the token would be absent regardless, but the
missing warning is the real gap.

**Why it matters.** Skills configured on a Claude agent vanish with no signal. The proposal
already calls for the Claude adapter to log-and-drop; live, only the drop happened.

**What was done.** A visible warning is emitted at the adapter boundary when skills are dropped
on a non-Pi harness.

### F-016 Code tools no longer execute: the sidecar gates every `kind: code` call as unsupported

**Status:** open (by-design gate; verify it is intentional and surface it better)
**Severity:** major (a previously-green headline capability now returns an error string as a
"successful" tool result; affects E2, E3, and E4 — every delivery path)
**Triage:** escalate (it is a deliberate change tied to the F-010 security finding, so the
question is the product decision: keep code tools removed, re-home their execution into the
sandbox, or restore them; not a one-file fix)
**Added:** 2026-06-25
**Commit:** 51e4c9e8e7 (branch `gitbutler/workspace`); the gate landed in `f93733a72a`
"fix(agent): reject sidecar code-tool execution as unsupported"
**Found in:** E2 sandbox-agent local (service `/invoke`) and E4 (SDK-direct via the local Node
runner), harness `pi_core` and `pi_agenta`, capability code tool (python runtime)
**Source:** `services/agent/src/tools/code.ts:19-27` — `runCodeTool` now unconditionally throws
`CODE_TOOL_UNSUPPORTED_MESSAGE` ("Code tools are not supported by the sidecar."). The module
docstring says every delivery path (direct Pi, sandbox Pi, ACP/MCP bridge) funnels a
`kind: "code"` call through here so it fails consistently.

**The problem.** A `code` tool that passed on 2026-06-20 (after the F-005 + F-006 fixes) now
fails. The runner advertises the tool to the model, the model calls it, and the relay throws
`Code tools are not supported by the sidecar.`. That throw becomes the tool _result_, so the
model either echoes the message back ("Code tools are not supported by the sidecar.") or
improvises ("I cannot execute that computation at the moment.") and the HTTP status is **200
Success** — the failure is invisible at the response envelope. On E4 the model fell back to
running the tool name as a shell command and got `command secret_math not found`.

**Repro.** `POST /services/agent/v0/invoke` (harness `pi_core`, `sandbox local`,
`model "openai/gpt-4o-mini"`) with a `code` tool `secret_math` (runtime python, returns
`'QA-CODE-OK-'+str(x*7+1)`) and the message "Call secret_math with x=6 and reply with exactly
the tool output." Expected `QA-CODE-OK-43`; got `Code tools are not supported by the sidecar.`
with status `Success`. Same on the E4 SDK-direct path (`SandboxAgentBackend` over
`services/agent` CLI). Captures: `qa/runs/E2__code_tool_pi_core.json`,
`E2__code_tool_pi_agenta.json` (regenerate from the scratchpad driver).

**Why it matters.** "Code tools" is a documented capability and the matrix marked it green on
E2/E3/E4. It is now a no-op that reports success. The earlier code-tool fixes (F-005, F-006)
are moot while this gate stands. The security motivation (F-010: code tools ran in the trusted
runner with no sandboxing) is legitimate, so this is likely intentional — but the matrix, the
docs, and the response contract still claim the capability works. At minimum the failure
should be loud (a non-200 or an explicit error event), not a tool-result string the model
launders into a "successful" reply.

**What to decide or do.** Confirm the gate is intentional (it reads that way). If so: (1) update
the matrix and the agent-workflows docs to mark code tools removed/blocked, (2) decide the
real home for code-tool execution (inside the Daytona sandbox per F-010, or a locked-down
subprocess), and (3) make the interim rejection fail loud rather than surface as a 200 tool
result. If it is NOT intentional, restore `runCodeTool`. Either way the silent-200 is the
worst part.

### F-017 A bare model string (no provider prefix) silently resolves to no credential

**Status:** resolved (2026-06-25, fail-loud with a clear message). Chose the smaller correct
option from "What to decide or do": NOT a model-id→provider inference table (a maintenance
burden and a guess), but a clear, actionable error. `_choose_default`
(`platform/connections.py`) now raises a new `MissingProviderError` when a bare model id
(`provider is None`) matches no vault candidate by model id — there is then no provider to look
a credential up against. The message is `model '<m>' needs a provider prefix (e.g.
'openai/<m>') or a structured {provider, model}; a bare model id can't resolve a credential`.
The agent handler (`services/oss/src/agent/app.py`) re-raises `MissingProviderError` even on a
default connection (it is an underspecified config, not a missing credential, so it is NOT the
tolerated self-managed/OAuth degrade). Provider inference is still preserved for the clean case:
a bare model id that DOES match a vault candidate by model id resolves and infers the provider
from the match. Tests: `test_bare_model_without_provider_fails_loud` +
`test_bare_model_matching_a_candidate_infers_the_provider`
(`platform/test_connections_http.py`), `test_default_connection_missing_provider_fails_loud`
(`test_invoke_handler.py`). The provider-qualified-but-no-key case is unchanged (still degrades
to harness login).
**Status (orig):** open
**Severity:** major (silent no-credential degrade; the run then fails auth with a misleading
"add the project's key to the vault" message even when the key IS in the vault)
**Triage:** defer (the resolver could infer the provider from the model id, but that is a
design choice — a model-id→provider table vs. requiring the provider prefix; touches the
shared connection resolver)
**Added:** 2026-06-25
**Commit:** 51e4c9e8e7 (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, harness `pi_core` and `pi_agenta`, model passed as the bare
string `gpt-4o-mini` (no `openai/` prefix), connection mode default (`agenta`, no slug)
**Source:** `sdks/python/agenta/sdk/agents/connections/models.py:128-147`
(`ModelRef.coerce`: a string with no `/` yields `provider=None`) +
`sdks/python/agenta/sdk/agents/platform/connections.py:283-310`
(`_candidate_pool`/`_choose_default`: with `provider=None` and no model-string match, the pool
is empty and the project-default connection resolves to nothing) +
`services/oss/src/agent/app.py:172` (logs "no connection resolved for provider None
(mode=agenta); running with no injected credential").

**The problem.** With the Default project's vault holding exactly one OpenAI `provider_key`,
`POST /invoke` with `model: "gpt-4o-mini"` (bare) injects no key and the runner returns HTTP
500 `pi_core: model authentication failed — add the project's OpenAI key to the project
vault, or log in (OAuth)`. The same request with `model: "openai/gpt-4o-mini"` or the
structured `{"provider":"openai","model":"gpt-4o-mini"}` resolves the key and returns `PONG`.
A `provider_key` candidate matches on `provider/model`, so with `provider=None` the resolver
cannot find the otherwise-present key. The service logs the no-credential degrade as a WARNING
and proceeds, so the auth failure looks like a missing key when the key is right there.

**Repro.** Vault has one OpenAI key. `POST /invoke` `{... "agent": {"harness":"pi_core",
"model":"gpt-4o-mini", ...}}` → 500 "model authentication failed". Change `model` to
`"openai/gpt-4o-mini"` → 200 `PONG`. Logs show `no connection resolved for provider None`
for the bare form.

**Why it matters.** The matrix's smoke scenarios and the legacy `run_matrix.py` driver pass a
bare `gpt-4o-mini`; on the current resolver that bare form fails auth despite a present key.
Every SDK/playground caller that sends a bare model id (the historical norm — `config.model`
was always a plain string) gets a confusing "add your key" error with the key already added.
The error text also misleads the user into re-adding a key that exists.

**What to decide or do.** Decide whether the resolver should infer the provider from a bare
model id (a maintained model-id→provider table, the litellm approach) or whether a bare model
id is unsupported and the API/UI must always send a provider. If inference is wanted, add it
in `_candidate_pool` / a pre-resolve step. If the prefix is required, make the no-provider
case fail loud with "model needs a provider (e.g. openai/gpt-4o-mini)" instead of degrading to
no-credential and then a generic auth error. Either way the "no connection resolved for
provider None" path should not masquerade as a missing-key error.

### F-018 The E4 in-process SDK backend (`LocalBackend`) is an unimplemented stub

**Status:** resolved (2026-06-25, doc-only). Corrected `matrix.md` and `qa/README.md`: E4 is now
described as "SDK-direct over the local Node runner CLI (`SandboxAgentBackend(cwd=services/agent)`)",
not "in-process Pi". Added a callout that `InProcessPiBackend` was renamed `LocalBackend` and is
a stub (`NotImplementedError`; in-process Pi/Claude are a later phase), so it cannot be the E4
backend, and that E4 exercises the same wire+runner as E2. The "E1 in-process Pi contrast"
section now notes that exact contrast can no longer be driven from the SDK. No code change (the
implementation gap is a known later phase, not a defect).
**Status (orig):** open (known incomplete, but the matrix lists E4 cells as `valid`)
**Severity:** docs/minor (the SDK-direct path still works via `SandboxAgentBackend` over the
local runner CLI, so E4 is coverable — it just is not the "in-process Pi" path the matrix
implies)
**Triage:** fix-now (a matrix/docs correction; the implementation gap itself is a known phase)
**Added:** 2026-06-25
**Commit:** 51e4c9e8e7 (branch `gitbutler/workspace`)
**Found in:** E4 local SDK backend, attempting the "in-process Pi" path
**Source:** `sdks/python/agenta/sdk/agents/adapters/local.py:29-52` —
`LocalBackend.create_sandbox` / `create_session` both `raise NotImplementedError(...)`
("LocalBackend is not implemented yet (Phase 3: Pi via bundled JS, Phase 4: Claude via
claude-agent-sdk)"). The old `InProcessPiBackend` was renamed to `LocalBackend`.

**The problem.** The matrix's E4 column ("local SDK backend") and several validity rules
describe E4 as the in-process path (`InProcessPiBackend`/`SandboxAgentBackend` on the host).
`InProcessPiBackend` no longer exists; its replacement `LocalBackend` is a stub. The only
working SDK-direct path is `SandboxAgentBackend(cwd=services/agent)` driving the Node runner
CLI as a subprocess — which was used here and PASSES for chat and append_system (E4 captures).
So E4 is real and testable, but via the sandbox-agent CLI, not in-process Pi.

**What to decide or do.** Update `matrix.md` to say E4 = "SDK-direct over the local Node runner
CLI (`SandboxAgentBackend`)" and note `LocalBackend` is a stub (in-process Pi/Claude are a
later phase). The E1 "in-process Pi" contrast path described in older results is likewise gone
from the SDK; if an in-process contrast is still wanted, it is now blocked on `LocalBackend`.

### F-019 Anthropic/Claude, gateway tools, MCP, and the live HITL round-trip are all blocked on per-project credential access in this stack

**Status:** open (environmental precondition, not a code defect)
**Severity:** environmental
**Triage:** none (provide a pi-agents-project-scoped API key, or add Agenta-managed Anthropic +
a Composio connection to the Default project, to unblock these cells)
**Added:** 2026-06-25
**Commit:** 51e4c9e8e7 (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local; harness `claude`, capability gateway tools, MCP, and HITL
**Source:** the vault/connections routes key off the API key's BOUND project, not `?project_id`
(F-004 lesson, still true). The available QA key (`examples/python/hotel_agent/draft/.env`,
prefix `N1twS5YQ`) is bound to the **hotel-agent** project (`019e8df5-635d-…`), whose vault has
only an OpenAI `provider_key` and zero Composio connections. (An earlier note said this key is
bound to Default — that was wrong; corrected in the 2026-06-25 re-run UPDATE below.) The real
Anthropic keys and the Composio connections live in the **Default** and **pi-agents** projects,
reachable only with a key bound to one of those projects.

**The consequences for this SDK-surface pass.**

- **Claude harness / Anthropic (Agenta-managed):** `pi_core` with `anthropic/claude-haiku-4-5-…`
  and the `claude` harness both return 500 `model authentication failed — add the project's
Anthropic key`. The Default vault has no Anthropic key and the sidecar has no baked
  `ANTHROPIC_API_KEY` (self-managed fallback unavailable). Resolution wiring is correct (the
  OpenAI path proves it); the blocker is purely credential access.
- **Gateway tools (Composio):** the Default project has zero connections, so there is nothing
  to resolve. `blocked:composio-connection` for this key.
- **MCP (stdio):** the services container runs with `AGENTA_AGENT_ENABLE_MCP=false`, and MCP
  lands only on Claude (F-009), which is itself credential-blocked. Double-blocked.
- **HITL approval round-trip:** the park→approve→resume path (`HITLResponder` in
  `services/agent/src/responder.ts`) answers a harness **permission gate**. Pi never gates tool
  use (`PiAgentConfig.wire_tools` hardcodes `permissionPolicy: "auto"`; the docstring says "Pi
  does not gate tool use"). Only **Claude** raises permission gates, so the live HITL
  round-trip needs the Claude harness — which is credential-blocked. The machinery exists and
  is unit-tested (`responder.ts`, `permissions.ts`); the `/messages` SSE path itself works on
  Pi (verified: start/text-delta/finish/[DONE] Vercel chunks), so the transport is proven,
  only the gate-raising harness is unavailable.

**What to do.** Hand the QA runner the **pi-agents** project's own API key (do not mint one
ad hoc), or add an Agenta-managed Anthropic `provider_key` and a Composio connection to the
Default project. Then re-run the Claude chat, Claude native-tool, gateway-tool, MCP, and the
`/messages` HITL approval cells. Use `haiku` (alias) and `gpt-4o-mini` only (cost guard).

**UPDATE 2026-06-25 (FE playground pass, overturns most of F-019):** Driving the live
playground UI in Chrome against the same Default project showed that **Claude/Anthropic,
gateway tools, and the Claude permission gate all work from the browser** — so the SDK-pass
reading that "Claude/Anthropic, gateway, MCP, HITL are all credential-blocked" is a property
of the `/invoke` SDK path and the per-project vault API, not of the platform:

- **Claude/Anthropic works** via the playground `Agenta-managed` + `Project default` path even
  though the Default vault has no `anthropic` `provider_key`. The platform resolves a
  **platform-managed Anthropic key** that is invisible to `GET /api/vault/v1/secrets/`. Live
  proof: `claude` harness, model `haiku`, replied `CLAUDE-HAIKU-5K8M`, $0.0106.
- **Composio connections DO exist on the Default project.** The playground Tool picker lists
  GitHub (`github-w9g`) and Google Calendar (`google-calendar-q92`) as connected integrations.
  (`POST /api/tools/connections/query?project_id=…` returned `count:0` for every project — that
  API read is wrong or scoped differently; trust the Tool picker.) Gateway tool ran end-to-end
  on Pi: `GET_THE_AUTHENTICATED_USER` returned the real login `mmabrouk`.
- **HITL:** the Claude permission gate fires (Ask rule honored) but the playground does not
  surface the interactive approve/deny prompt — see F-024.
  Re-scope F-019: the SDK `/invoke` path is still credential/connection-limited as written, but
  the playground surface is not. The model/auth, gateway, and Claude cells are GREEN on the FE.

**UPDATE 2026-06-25 (SDK-surface re-run, ROOT CAUSE corrected — the FE "platform-managed key"
reading was wrong):** Re-ran the credential-blocked SDK cells against the `/invoke` path with
the `examples/python/hotel_agent/draft/.env` key (`N1twS5YQ`). All stayed blocked, and the
DB shows why the earlier provenance was mistaken on two points:

1. **The QA key is bound to `hotel-agent`, NOT `Default`.** `api_keys` has prefix `N1twS5YQ`
   with `project_id = 019e8df5-635d-…` (= **hotel-agent**), and the vault key it returns
   (secret id `019e922e-e078-…`) belongs to hotel-agent too. The hotel-agent vault has only an
   OpenAI `provider_key` — no Anthropic, no Composio connections. NO API key exists for the
   `Default` project (`019e8df5-2a58-…`) at all. So every prior statement that this key is
   "bound to Default" is incorrect; the F-019 blockers are simply hotel-agent's empty vault.
2. **There is NO "platform-managed Anthropic key invisible to `/secrets/`."** The Default vault
   genuinely HAS a real Anthropic `provider_key` (secret id `019ef5cd-9bee-…`, added
   2026-06-25), alongside OpenAI and the `github-w9g` / `google-calendar-q92` connections. The
   FE playground worked because it runs **as the logged-in user with `Default` selected**, so it
   reads Default's real vault. The SDK `/invoke` path can't reach it only because no
   Default-scoped API key was available. The "platform-managed / invisible key" hypothesis is
   retracted: an investigation of the resolver (`platform/connections.py`) and both containers
   confirmed (a) the agent path's `VaultConnectionResolver` does a bare `GET /secrets/` with the
   caller's auth and **no `?project_id`**, so it always reads the API key's BOUND project's
   vault; (b) neither the `services` nor the `sandbox-agent` container has any baked
   `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` env (the only env-merge fallback, used by the
   completion/chat path via `VaultMiddleware`, would also be empty here — and the agent path
   doesn't consult it anyway).

**Why `?project_id` does not help.** `/invoke?project_id=Default` routes the invocation, but
credential + connection resolution still keys off the API key's bound project (hotel-agent),
because `GET /secrets/` and `POST /tools/connections/query` both ignore the query param and use
`request.state.project_id` (the F-004 lesson, now proven structural in
`sdks/python/agenta/sdk/agents/platform/connection.py` `headers()` — Authorization only, no
project header). I queried connections for all four projects with `?project_id=…`; every one
returned `count:0`, including `pi-agents` which has 3 valid connections in the DB — the param is
inert on that route.

**Cells re-run this pass (all against the hotel-agent-bound key, E2 `/invoke`):**
| Cell | Result | Detail |
| --- | --- | --- |
| Claude chat / haiku / Agenta-managed | **blocked (500)** | `claude: model authentication failed — add the project's Anthropic key`; hotel-agent vault has no Anthropic key |
| Anthropic-on-Pi / `pi_core` `anthropic/claude-haiku-4-5-…` | **blocked (500)** | `pi_core: model authentication failed`; same cause; resolution wiring correct (OpenAI path is green) |
| Gateway (Composio GitHub) / `pi_core` | **blocked (500)** | `Gateway tool resolution failed (HTTP 404)` — `github-w9g` lives in Default, invisible to the hotel-agent key |
| Gateway (Composio GitHub) / `claude` | **blocked (500)** | same 404 at `resolve_tools` (gateway resolves BEFORE the model-auth step, so it 404s first) |
| HITL / `claude` gated tool / `/invoke` | **blocked (500)** | same gateway 404; and `/invoke` is headless anyway (see SDK HITL characterization below) |
Captures: `qa/runs/E2__F019_*.json`.

**SDK HITL behavior — characterized precisely (static, since Claude is credential-blocked):**
The SDK path has the SAME break as F-024 on `/messages`, and does NOT do HITL at all on
`/invoke`. The machinery (`responder.ts`, `permissions.ts`, `vercel/stream.py`):

- On a harness permission gate, `attachPermissionResponder` (`permissions.ts:21-44`) ALWAYS
  first `emitEvent({type:"interaction_request", kind:"permission", …})`. The Vercel egress
  (`vercel/stream.py:201-242`) DOES map that to the AI SDK `tool-approval-request` part with the
  correct `toolCallId`. So an **approval-request IS produced** — the FE renderer has something
  to bind to. That part of the wire is correct.
- BUT in the same callback, `responder.onPermission(...)` is awaited and its decision is sent
  back to the harness via `respondPermission`. For `/messages` (`hasHumanSurface = !!sessionId`,
  `sandbox_agent.ts:350`), `HITLResponder.onPermission` (`responder.ts:87-92`) returns `"deny"`
  to "park" when there is no stored decision — and `decisionToReply` (`responder.ts:177-189`)
  maps `deny → "reject"`. So the harness is told to **reject the tool in the same turn**, which
  resolves the tool call as a **tool error ("User refused permission")**. That is exactly the
  F-024 symptom: the approval-request part is emitted, then immediately undercut by a
  reject→tool-error in the same turn, so the FE shows the ERROR instead of a true pause. The
  "park, resume next turn" intent is not realized because the gate is answered (rejected) inline
  rather than left genuinely suspended.
- On `/invoke` (no `sessionId`, `hasHumanSurface=false`) there is no HITL: `HITLResponder`
  falls through to `basePolicy` (default `auto`/allow), byte-identical to `PolicyResponder`. A
  gated tool just runs; no approval event, no pause. This is by design (headless batch).
  So: **SDK = same break as F-024**, rooted in the runner answering the gate inline with a reject
  rather than suspending the run after emitting the approval part. This feeds the HITL design
  effort: the fix is to NOT auto-`reject` when `hasHumanSurface` and no decision yet — emit the
  approval part and end the turn WITHOUT resolving the tool (true suspend), then resume on the
  next turn via the stored-decision branch (`responder.ts:88-89`), which already works.

**What to do (unchanged, now precise).** To run the credential cells on the SDK `/invoke`
surface, either (a) create an API key bound to the **Default** project (it has the real
Anthropic key + the github-w9g connection) or to **pi-agents** (Anthropic + github-tvn), or
(b) bake an `ANTHROPIC_API_KEY` into the `services`+`sandbox-agent` containers for a
self-managed fallback. The hotel-agent key fundamentally cannot reach another project's vault on
the agent path. (This pass did not mint a key — out of scope for a read-only QA run.)

### F-020 Playground UI is unreachable on the `localhost` origin (cross-origin auth failure)

**Status:** documented, not a product bug (2026-06-25). ASSESSED: dev-stack quirk, not a
CORS/origin product defect. The product already supports same-origin: `getAgentaApiUrl()`
(`web/packages/agenta-shared/src/api/env.ts`) returns `NEXT_PUBLIC_AGENTA_API_URL` if set, else
**falls back to the current page origin** (`buildRuntimeOrigin()`). A standard OSS deployment
leaves the public URL unset (`hosting/docker-compose/oss/docker-compose.gh.yml`:
`AGENTA_HOST: ${AGENTA_HOST:-}`), so login works on whatever origin the browser is on. The dev
stack alone PINS the public URL to the box IP
(`hosting/docker-compose/ee/docker-compose.dev.yml`:
`AGENTA_HOST: ${AGENTA_HOST:-http://144.76.237.122:8280}`) so the remote dev box is reachable
from outside — that pin is exactly what makes `localhost:8280` cross-origin and breaks login.
Forcing a "serve same-origin when on localhost" FE change would override an intentional,
explicitly-configured public URL and is the risky change the task said not to make. The safe fix
is to document it: this is the same rule the `debug-local-deployment` skill already carries
("always use the IP, never localhost"). No code change.
**Status (orig):** open
**Severity:** minor
**Triage:** small-fix (dev-env config) / partly architectural (origin contract)
**Added:** 2026-06-25
**Commit:** `gitbutler/workspace` (stack at v0.104.2)
**Found in:** FE playground, login, on the dev stack (compose `agenta-ee-dev-wp-b2-rendering`,
traefik `0.0.0.0:8280`)

**The problem.** The web app served at `http://localhost:8280` issues every auth/API call to
`http://144.76.237.122:8280` (the configured `AGENTA_WEB_URL`/public API URL). Loading the UI
on the `localhost` origin makes those cross-origin requests fail (`net::ERR_FAILED` on
`/api/auth/session/refresh`, `/api/auth/discover`, `/api/auth/signup`), so login dies with
"Unable to connect to the authentication service." The exact same stack works when the browser
is on the **IP** origin (`http://144.76.237.122:8280`), because the cookies/CORS origin then
matches. The repro: navigate to `localhost:8280`, enter the email+password, click Continue →
"Unable to connect to the authentication service"; switch to `144.76.237.122:8280` → logged in.

**Why it matters.** A task that says "test on localhost:8280" cannot use the UI at all unless
the tester knows to switch to the IP origin. It is a silent dev-env footgun (the API health on
localhost is 200, so the stack looks up).

**What to do.** This is the same class as the `debug-local-deployment` skill rule ("always use
the IP, never localhost"). Either document it loudly for QA, or make the dev env serve a
same-origin API base when the page origin is `localhost`. Not a product bug; an env/contract
gap. (Also a Next.js dev error overlay popped on the transient discover `AxiosError` and blocked
the password field until dismissed — minor dev-mode UX.)

### F-021 Model picker is filtered per harness (PASS) — Connection picker is "Project default"-only (known deferred)

**Status:** open (informational + known deferred)
**Severity:** minor
**Triage:** defer (deferred UX, do not re-litigate)
**Added:** 2026-06-25
**Commit:** `gitbutler/workspace` (v0.104.2)
**Found in:** FE playground, agent config form, all harnesses

**What works (record as PASS).** The provider+model picker is correctly filtered per harness:
on **Pi**/`pi_core` and **Pi (Agenta)**/`pi_agenta` it shows all 8 vault providers (OpenAI 37,
Anthropic 12, Gemini 16, Mistral 14, Groq 8, MiniMax 5, Together 15, OpenRouter 23); on
**Claude Code** it shows **only Anthropic** (8 alias models: `default`/`sonnet`/`opus`/`haiku`
and their `[1m]` variants). The search box filters correctly with real keystrokes. Switching
harness resets the selected model to "Select a provider" (expected, since the provider set
changes), and the Claude harness reveals an extra "Advanced: Claude permissions" panel.

**The deferred item (do not re-litigate).** The **Connection** picker under `Agenta-managed`
offers only one option, "Project default" (`__default__`). The named-connection picker is the
known deferred UX item from the provider-model-auth work. Recording it here so the matrix has a
home for it; no action needed this pass.

### F-022 Code-tool inline editor exists in the FE; execution still gated at the sidecar (inherits F-016)

**Status:** open (FE-present; execution = F-016)
**Severity:** minor
**Triage:** defer (FE) / escalate (the F-016 sidecar gate)
**Added:** 2026-06-25
**Commit:** `gitbutler/workspace` (v0.104.2)
**Found in:** FE playground, Tool picker, harness Pi

**The observation.** The Tool picker's `CUSTOM TOOLS` section offers "Create in-line function
tool", so the author-facing surface for a `kind: code` tool exists in the playground. Code-tool
**execution** is still the known sidecar gate (F-016: the sidecar returns "Code tools are not
supported by the sidecar" as a 200 tool result). That is an existing escalate-level finding, so
the code-tool cell stays blocked on F-016, not on a new FE defect. (The inline editor's full
open/save flow was not exercised this pass due to picker interaction friction; the FE option is
present.)

### F-023 Gateway tool (Composio) works end-to-end from the playground on Pi (PASS, evidence)

**Status:** resolved/PASS (recorded as a green cell)
**Severity:** n/a (pass record)
**Triage:** n/a
**Added:** 2026-06-25
**Commit:** `gitbutler/workspace` (v0.104.2)
**Found in:** FE playground, harness `pi_core`, model `gpt-4o-mini`, capability gateway tools

**The result.** Added the GitHub Composio action `GET_THE_AUTHENTICATED_USER` (connection
`github-w9g`) from the Tool picker; the config shows a generated tool
`tools__composio__github__GET_THE_AUTHENTICATED_USER__github-w9g`. Prompted the agent to call
it and return the `login`. The chat rendered a tool-call card ("github\_\_GET_THE_AUTHENTICATED_USER
Completed") with collapsible INPUT `{}` / OUTPUT (the real GitHub API JSON), and the agent's
final reply was `GH-USER:mmabrouk` — the real connected login, unguessable, $0.000435. This
proves the gateway callback to `/tools/call` works from the browser. The tool-call render
(collapsible INPUT/OUTPUT, status badge) also works. Worth pinning as a replay regression.

### F-024 Claude permission gate fires, but the playground HITL approve/deny prompt never appears (tool auto-denied)

**Status:** open
**Severity:** major
**Triage:** architectural (wire mapping: harness gate → AI SDK `approval-requested` part)
**Added:** 2026-06-25
**Commit:** `gitbutler/workspace` (v0.104.2)
**Found in:** FE playground, harness `claude`, model `haiku`, capability HITL approval, with a
gateway tool delivered over MCP

**The repro.** Claude harness + `haiku` + the GitHub gateway tool. In "Advanced: Claude
permissions" set **Ask rules** to match the tool (`mcp__*`, `GET_THE_AUTHENTICATED_USER`,
`mcp__composio__*`). Sent "Use the GET_THE_AUTHENTICATED_USER github tool now … then reply
with HITL-DONE."

**What happened.** The Claude permission gate **did** fire (the Ask rule was honored — proof
the gate is wired). The tool was delivered to Claude over the MCP bridge as
`mcp__agenta-tools__github__GET_THE_AUTHENTICATED_USER`. But the playground showed **no inline
"Run this tool?" / Approve / Deny prompt** and **no "Awaiting approval"** chip. Instead the
tool-call card resolved straight to **ERROR: "User refused permission to run tool"** — the run
auto-denied without ever presenting the approve/deny buttons or pausing for the user.

**Why it matters.** The HITL approve→resume round-trip is the headline interactive feature.
The renderer exists: `web/oss/src/components/AgentChatSlice/components/ToolPart.tsx` renders
Approve/Deny for the AI SDK v6 `approval-requested` tool-part state, wired through
`AgentChatPanel` (`addToolApprovalResponse`, `sendAutomaticallyWhen`) and egressed as
`tool_approvals` in `assets/transport.ts`. But the live Claude/sandbox-agent path never emits a
stream part in the `approval-requested` state — the harness gate maps to a tool **error**
("User refused permission") rather than to a pause-for-approval part. So the park→approve→resume
UX cannot trigger from the playground for the Claude gated-tool path; the user is auto-denied.

**What to decide or do.** Trace the Claude/sandbox-agent gate: when an "ask" rule matches,
the runner should emit the AI SDK `approval-requested` part (so `ToolPart` shows Approve/Deny
and `addToolApprovalResponse` can resume) instead of resolving the tool with a "refused
permission" error. Likely a gap in `services/agent/src/responder.ts` / `permissions.ts`
(`HITLResponder`) ↔ the Vercel egress mapping. Until then the playground HITL approval cell is
a **FAIL** end-to-end even though the gate itself works. Note: the Pi `Permission policy` field
only offers `auto`/`deny` (no `ask`), so HITL is not configurable for Pi at all from the form.

### F-025 Agent chat renders with duplicate React keys (console warning x1000+)

**Status:** resolved (2026-06-25). The message-part list in
`web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx` keyed each rendered part by
its bare array index (`key={i}`), which collides across messages React reconciles together.
Replaced with a stable, conversation-unique key per part (`${message.id}-${i}` for parts/files,
`${message.id}-source-${i}` for sources), so every rendered child is unique across the whole
conversation. Low-risk FE-only change; eslint clean.
**Status (orig):** open
**Severity:** minor
**Triage:** small-fix
**Added:** 2026-06-25
**Commit:** `gitbutler/workspace` (v0.104.2)
**Found in:** FE playground, agent chat panel (`AgentChatSlice`), any multi-part conversation

**The problem.** During an agent conversation with several messages/tool parts, the console
logs "Encountered two children with the same key" — observed **1143 times** in one session.
Duplicate React keys can duplicate/omit children and is unsupported. Likely the message/part
list in `AgentChatSlice` (e.g. `AgentMessage`/`ToolPart` keys) reuses an id across parts.

**What to do.** Give each rendered conversation part a stable unique key (message id + part
index, or the part's own id). Low-risk FE fix.

### F-026 HITL approve/deny prompt now RENDERS and Approve resumes (F-024 core symptom fixed), but the settle delay is ~70-140s and the gate can re-fire on a model tool-name fumble

**Status:** settle-delay RESOLVED — live-verified 2026-06-25 on merged big-agents (`6324757e86`).
The ~70-140s delay is gone: the Approve/Deny buttons are `disabled:false` the instant the prompt
renders (`ToolPart.tsx:76` "clickable AS SOON AS the prompt renders … not gated on busy");
measured prompt at ~3.9s (model-bound). Approve → resume → real tool result + final token. NEW
residual found this pass: **Deny does NOT resume** (tool stuck in `approval-responded`, turn
dead-ends, no resume request) — tracked in F-036. (Was: open, partial improvement over F-024.)
**Severity:** major (the approval round-trip works mechanically, but the UX is slow and can loop)
**Triage:** defer (the renderer + resume now work; residuals are timing/UX + model behavior, need a
design call on the settle delay and on de-duplicating repeated gates)
**Added:** 2026-06-25
**Commit:** `gitbutler/workspace` (v0.104.2, merged big-agents)
**Found in:** FE playground (logged-in user, Default project), harness `claude`, model `haiku`,
GitHub gateway tool delivered over the MCP bridge, "Advanced: Claude permissions" Ask rules set
(persisted from the prior session's draft config), Permission policy "Auto"

**What changed vs F-024.** On the merged big-agents stack the playground **now shows the inline
"Run this tool?" Approve / Deny prompt and an "Awaiting approval" chip** on the Claude gated-tool
path. This is a direct change from F-024, which reported the prompt never appeared and the tool
auto-denied with "User refused permission to run tool." That auto-deny did NOT reproduce here:
the tool-call card pauses at "Awaiting approval" and waits for the user. Clicking **Approve
resumes the turn** (the awaiting-approval card flips to "Responded" and the agent loop
continues). So the park → approve → resume machinery is live end to end.

**Residual 1 — very long settle delay before the buttons enable.** When the approval card first
appears, the Approve/Deny buttons are rendered but `disabled` while the stream is still active
("Stop loading" present). In this run the buttons did not become clickable until **~70s, then a
second observed window pushed the full settle to ~140s** before "Stop loading" cleared and
Approve enabled. That far exceeds the noted ~30-60s. During that window the user sees Approve/Deny
but cannot click them, which reads as a hang.

**Residual 2 — the gate can re-fire because haiku mis-names the MCP tool.** After Approve, haiku
frequently re-issued the tool with the wrong name `mcp__agenta_tools__github__…` (underscores)
instead of `mcp__agenta-tools__github__…` (dashes), got
`<tool_use_error>Error: No such tool available</tool_use_error>`, re-ran ToolSearch, then hit a
**fresh** "Awaiting approval" gate. So a single user request produced several approval gates in a
row. This is partly a model-behavior issue (haiku tool-name confusion) but the UX consequence is
real: the approval round-trip can loop, each loop incurring the long settle delay.

**Repro.** Claude Code harness + `haiku` + the `github / GET_THE_AUTHENTICATED_USER / github-w9g`
gateway tool, with Ask rules matching the tool. Send "Call the github GET_THE_AUTHENTICATED_USER
tool now, then reply with exactly: HITL-APPROVE-7Q42". The chat reaches "Awaiting approval" with
Approve/Deny; the buttons stay disabled ~70-140s; clicking Approve resumes; haiku then often
re-calls with the underscore name, errors, and lands on another approval gate. A clean
token-terminated run was not reached in this pass because of the loop, but the gate render + the
approve-resume transition were both observed directly.

**What to decide or do.** (1) Investigate the ~70-140s settle: enable the Approve/Deny buttons as
soon as the approval part is emitted (do not gate them on the whole stream finishing), and/or show
an explicit "waiting" affordance so it does not read as a hang. (2) Consider de-duplicating
repeated gates for the same tool/connection within a turn, or surface the tool's correct MCP name
so the model stops fumbling dash-vs-underscore. (3) Cross-check the wire: F-024's claimed mapping
(gate → tool error) appears to have been changed to (gate → AI SDK `approval-requested` part);
confirm in `services/agent/src/responder.ts` / `permissions.ts` and the Vercel egress, and update
F-024 to resolved-with-residual pointing here. This was characterized live on the FE only; the
SDK `/invoke` path (F-019 HITL note) is a separate surface.

**A note on the FE composer (testing aid, not a product finding).** The chat composer's send
button (and Approve/Deny enabling) is driven by real keyboard events. Setting the textarea
`.value` via DOM or even a synthetic React `input` event leaves the send button **disabled**;
only real keystrokes (or the app's own typing) enable it. Automated drivers must type with real
key events, not value-injection, or the message silently never sends. Captured here so a future
QA run does not lose time to it.

### F-027 Code tools now FAIL LOUD (HTTP 500), not a silent 200 — the worst part of F-016 is resolved

**Status:** resolved-the-silent-part (2026-06-25). The capability is still gated off (per F-010
security), but the silent-200 laundering is gone.
**Severity:** major → downgraded (the silent-200 was the dangerous part; it is fixed)
**Triage:** verify (confirm the gate is still intentional) + docs (mark code tools as fail-loud,
not silently no-op)
**Added:** 2026-06-25 (SDK/API surface re-run)
**Commit:** `2389401ac3` (branch `gitbutler/workspace`; the new sidecar-uri commit `f8cfee3908`
sits on top). The gate lives at `services/agent/src/tools/code.ts` (`CODE_TOOL_UNSUPPORTED_MESSAGE`).
**Found in:** E2 sandbox-agent local, `/invoke` AND `/messages`, harness `pi_core`, code tool python

**The change vs F-016.** F-016 reported a `kind:code` call funneling the
`"Code tools are not supported by the sidecar."` string through as a 200 tool _result_ the model
launders into a "successful" reply. On this stack the same run returns **HTTP 500** with the body
`{"ok":false,"error":"Code tools are not supported by the sidecar."}`, surfaced by the service as a
500 with that message. On `/messages` SSE the same run emits an `error` stream part
(`{"type":"error","errorText":"Agent run failed: ..."}`) then `[DONE]`. So the failure is now
visible at the response envelope on both entrypoints — the F-016 "silent-200 is the worst part"
concern is addressed.

**Repro.** `POST /invoke` (harness `pi_core`, `model openai/gpt-4o-mini`) with a `code` tool
(correct shape: `{type:code, name, runtime, script, input_schema}` — note the wire field is
`script`, NOT `code`/`parameters`; the old shape now 500s at config validation with
`code.script Field required`). Ask the agent to call it. Result: HTTP 500
`Code tools are not supported by the sidecar.` Captures: `runs/E2_2026-06-25__INV2_code_tool_correct_pi_core.json`,
`runs/E2_2026-06-25__MSG_code_tool_pi_core.json`.

**What to do.** Confirm the gate is still intentional (it reads that way; F-010 security motive
stands). Update the matrix + docs: code tools = blocked-but-fail-loud, not silently-no-op. Decide
the real execution home (Daytona sandbox / locked-down subprocess) per F-010. The interim behavior
is now correct (loud error).

### F-028 Author-supplied skills load on plain `pi_core`, not only `pi_agenta` — matrix validity rule 4 is now wrong

**Status:** open (matrix/docs correction; behavior is arguably an improvement)
**Severity:** docs/minor (the matrix marks skills `n/a` on `pi`; live they work)
**Triage:** fix-now (matrix correction) + verify (decide if pi_core-skills is intended)
**Added:** 2026-06-25
**Commit:** `2389401ac3` (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, `/invoke`, harness `pi_core` AND `pi_agenta`, capability skills

**The problem.** `matrix.md` validity rule 4 says "Skills are an Agenta-harness feature … a plain
`pi` run does not load skills … skill cells are `valid` on `agenta` and `n/a` on `pi`." Live, an
author-supplied inline `SkillConfig` in `parameters.agent.skills` loads and is invoked on **both**
`pi_core` and `pi_agenta`: the unguessable token `SKILL-LOADED-7Q42-OK` appeared in the reply on
both, and the `pi_core` trace shows an `execute_tool read` span (Pi reading the materialized
`SKILL.md`). The runner log shows `[sandbox-agent] skills: weather-oracle` for both. The negative
control (`skills: []`) produced no token. So the `skills` field is honored for the whole Pi family,
not just the Agenta harness.

**Repro.** `POST /invoke` harness `pi_core`, `model openai/gpt-4o-mini`,
`skills:[{name, description, body}]`, message that matches the skill description. Token appears.
Captures: `runs/E2_2026-06-25__SKILL_inline_pi_core.json`,
`runs/E2_2026-06-25__SKILL_inline_agenta.json`, `runs/E2_2026-06-25__SKILL_negctl.json`.

**What to do.** Correct `matrix.md` rule 4 and the capability table: author skills are `valid` on
`pi_core` and `pi_agenta`. Decide whether plain-`pi_core` skill loading is intended (it follows
from `skills` being a Pi-family wire field, not a per-harness gate) or whether it should be gated to
`pi_agenta`. The `pi_agenta`-forces-platform-skills story is unchanged; this is about author skills.

### F-029 Skills are invisible in traces beyond the config echo — no "skill used", no forced/platform skills

**Status:** RESOLVED — live-verified 2026-06-25 on merged big-agents (`6324757e86`). Pi
(`pi_agenta`) + inline `qa-skill`: the `invoke_agent` span carries
`ag.unsupported.agent.skills.loaded=["qa-skill"]` + `ag.unsupported.agent.skills.count=1`, and the
skill appears as its own span. Two residuals: the attrs sit under the `ag.unsupported.*` namespace
(not first-class `ag.agent.skills.*`), and the forced `_agenta.*` platform skills did NOT show in
`loaded` (only the author skill) — re-check whether the platform catalog injects on this stack.
See F-036. (Was: fixed on `fix/agent-sdk-tracing-findings`, pending live re-verify.)
**Severity:** minor (observability gap; the run itself works)
**Triage:** done. The agent span now carries `ag.agent.skills.loaded` (the materialized skill
names, BOTH author and forced `_agenta.*`) and `ag.agent.skills.count`, on every harness:
the runner's `createSandboxAgentOtel` stamps it for Claude/Daytona, and for local Pi the runner
passes the names to Pi's own extension via `AGENTA_SKILLS_LOADED`, which `createAgentaOtel`
stamps on Pi's `invoke_agent` span at `agent_start`. The forced platform skills ride
`request.skills` already, so they appear without special casing (D-011).
**Added:** 2026-06-25
**Commit:** `2389401ac3` (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, `/invoke`, harness `pi_agenta` and `pi_core`, capability skills;
observability path `GET /api/preview/tracing/traces/{trace_id}`

**The problem.** Task-level tracing review asked to verify, in the traces: skills linked, skills
used, and the Agenta hard-coded (forced/platform) skills. Only the FIRST is present. The `_agent`
workflow span echoes the author skill config (`ag.data.inputs.parameters.agent.skills =
[{body:…, description:…, name:…}]`), so a viewer can see which skills were _configured_. But there
is **no span or attribute for a skill being surfaced/loaded/invoked** — the materialization fact
(`[sandbox-agent] skills: weather-oracle`, present in the runner log) never reaches a span. And the
`pi_agenta` harness's **forced/platform `_agenta.*` skills are not echoed at all** (the trace shows
only the author-supplied `skills`, not the server-side forced set the harness adds). So "which
skills actually ran, incl. the Agenta hard-coded ones" cannot be answered from the trace.

**Repro.** Run a skill cell, fetch the trace, grep span attributes for `skill`. Only the
`ag.data…agent.skills` config echo on `_agent` matches; no skill span, no forced-skill attribute.

**What to do.** Decide a skill trace signal: emit a span attribute (or event) when a skill is
materialized/surfaced/invoked, and echo the resolved forced/platform skill set the harness injected
(not just the author config) so the trace reflects what actually loaded. Same observability class
as the missing tool-execution detail when a run errors (F-030).

### F-030 Error runs trace only an error COUNT, not the error message/provider — diagnostics live only in the HTTP body

**Status:** RESOLVED — live-verified 2026-06-25 on merged big-agents (`6324757e86`). Pi + gemini
(no key): a dedicated `agent_error` span with `status STATUS_CODE_ERROR`,
`ag.unsupported.error.message="pi_core: model authentication failed — add the project's Gemini key…"`,
`ag.unsupported.error.provider="gemini"`, plus an `exception` event (`exception.type=AgentRunError`).
Residual: the `ag.unsupported.*` namespace (a categorization wrinkle, data is correct). See F-036.
(Was: fixed on `fix/agent-sdk-tracing-findings`, pending live re-verify.)
**Severity:** minor (observability gap)
**Triage:** done. A new `recordError(message, provider)` on the sandbox-agent otel stamps
`ag.error.message`, `ag.error.provider`, an OTel exception event, and ERROR status on the agent
span before finish/flush, on both the catch path and the swallowed-Pi-error path. When the
harness self-instruments (local Pi: the runner has no owned span) it emits a standalone
`agent_error` span under the caller's traceparent so the diagnostic still reaches the `/invoke`
trace (D-010). The message is the same concise text the HTTP response carries.
**Added:** 2026-06-25
**Commit:** `2389401ac3` (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, `/invoke`, error cases (missing Anthropic key, gateway 404,
code-tool gate), observability path `GET /api/preview/tracing/traces/{trace_id}`

**The problem.** Every error run (Anthropic-no-key on `pi_core` and on `claude`, gateway-tool 404,
code-tool fail-loud) produces a single `_agent` span carrying `ag.metrics.errors.cumulative = 1` /
`ag.metrics.errors.incremental = 1` and the config echo — but **no error message, no exception
event, no provider label, and no nested LLM/tool spans**. The actionable text ("pi_core: model
authentication failed — add the project's Anthropic key", "Gateway tool resolution failed (HTTP
404)", "Code tools are not supported by the sidecar.") is in the HTTP 500 response body and the
`/messages` `error` part, but NOT in the trace. A trace viewer sees an error happened, with zero
diagnostic detail.

**Repro.** Run any error cell (e.g. `pi_core` + `anthropic/claude-haiku-4-5-…` with no Anthropic
key), fetch the trace: `errors.cumulative=1` is the only error signal; the message is absent.
Captures: `runs/E2_2026-06-25__INV_err_anthropic_pi_core.json` (HTTP body has the text) vs the
trace (count only).

**What to do.** Record an OTel exception event / `ag.error.message` (and the provider that failed)
on the `_agent` span when a run errors, so the trace carries the same diagnostic the response does.
The right-provider naming is already correct in the response (F-031); the gap is that it never
reaches the span.

### F-031 Right-provider-on-error and model resolution confirmed; the Claude alias now needs a provider prefix (F-017 side-effect)

**Status:** UPDATED 2026-06-25 (merged big-agents `6324757e86`). The Wave-1 alias fix
(`3a5124402a`) made the RUNNER accept a bare Claude alias: `:8790` sidecar `/run` with bare
`model:"haiku"` runs and returns `"model":"haiku"`, and the FE model picker now lists all 8
aliases (`default/sonnet/opus/haiku` + `[1m]`). BUT on the SERVICE path the connection resolver
still needs a provider, so bare `haiku` on `/messages` still hits the F-017 provider-prefix error;
the FE works because it sends the structured `{model:"haiku", provider:"anthropic"}` (verified
end-to-end in the HITL run). Residual unchanged: decide whether the service resolver should infer
`anthropic` for a Claude-harness alias, and fix the error hint to suggest `anthropic/<m>` (not
`openai/<m>`) when harness is `claude`. Right-provider-on-error re-confirmed live (Gemini). See F-036.
(Was: mostly-PASS with one interaction to record.)
**Severity:** minor (a doc/UX interaction: the documented Claude `model: "haiku"` alias now fails)
**Triage:** verify (decide whether the Claude alias should be exempt from the F-017 prefix rule)
**Added:** 2026-06-25
**Commit:** `2389401ac3` (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, `/invoke`, harnesses `pi_core` and `claude`

**Confirmed PASS (task items 2 + 3).**

- **Right-provider-on-error:** the auth-failure message names the harness AND the provider actually
  called: `pi_core: model authentication failed — add the project's Anthropic key …` (Pi calling
  Anthropic) and `claude: model authentication failed — add the project's Anthropic key …` (Claude).
  Both the provider-prefixed `anthropic/claude-haiku-4-5-…` and the structured
  `{provider:anthropic, model:haiku}` reach the auth step (so the resolver accepts both forms).
- **Model resolution matches config:** the LLM span records `gen_ai.system = openai`,
  `gen_ai.request.model = gpt-4o-mini`, `gen_ai.response.model = gpt-4o-mini` — the configured
  `openai/gpt-4o-mini` actually ran. The sidecar log shows the ACP `model` category allows only
  `openai-codex/*` ids and falls back to the harness default for anything else, but the real LLM
  call is routed by Pi through the injected key + litellm at the requested `gpt-4o-mini` (cost
  ~$0.0002/run confirms gpt-4o-mini, not gpt-5.x). So model selection is honored where it matters.
  (This refines F-007: the ACP `model` category is NOT how the Pi model is chosen; the injected
  connection is.)

**The one interaction to record.** F-017's fail-loud "a bare model id needs a provider prefix" now
ALSO rejects the **Claude alias** `model: "haiku"`: a `claude` harness run with bare `haiku` returns
500 `model 'haiku' needs a provider prefix (e.g. 'openai/haiku') …` and never reaches the harness.
The matrix and `matrix.md`'s model-auth scenarios document `model: "haiku"` (bare alias) as the
required Claude form (to dodge the old F-007 cost trap). With F-017 in place that bare alias now
fails loud; the working forms are `anthropic/haiku` or `{provider:anthropic, model:haiku}`. The
error text even suggests `openai/haiku`, which is wrong for the Claude harness (Anthropic-only).

**Repro.** `claude` harness, `model:"haiku"` → 500 needs-prefix. `model:"anthropic/haiku"` or
`{provider:"anthropic","model":"haiku"}` → reaches auth (then 500 no-key on hotel-agent, which is
the F-019 credential block, not a resolution bug). Captures: `runs/E2_2026-06-25__INV_err_claude_chat.json`
(bare, prefix error), `runs/E2_2026-06-25__INV2_err_claude_prefixed.json` +
`runs/E2_2026-06-25__INV2_err_claude_struct.json` (both reach auth).

**What to do.** Decide whether the Claude harness aliases (`haiku`/`sonnet`/`opus` + `[1m]`) should
be exempt from the F-017 provider-prefix requirement (they are unambiguously Anthropic), and fix the
error hint to suggest `anthropic/<m>` (not `openai/<m>`) when the harness is `claude`. Update
`matrix.md`'s Claude model-auth scenarios to use a provider-qualified model.

### F-032 User-declared MCP servers (stdio AND http) are dropped SILENTLY on the Pi family — no log, no error, HTTP 200

**Status:** open
**Severity:** minor (silent-drop UX; same class as F-009/F-015)
**Triage:** defer (decide hide/warn on `mcp_servers` for the Pi family)
**Added:** 2026-06-25
**Commit:** `2389401ac3` (branch `gitbutler/workspace`)
**Found in:** E2 sandbox-agent local, `/invoke`, harness `pi_core`, capability MCP (stdio + http)
**Source:** `services/agent/src/engines/sandbox_agent/mcp.ts:128` —
`if (isPi || !capabilities.mcpTools) { … return {servers:[], …} }`; the `log(... not delivered)`
line inside that branch only fires for `!isPi`, so for the Pi family the drop is logged NOTHING.

**The problem.** The current `mcp.ts` ENABLES http MCP and DISABLES stdio (fail-loud) — but ONLY on
the non-Pi (Claude) branch. On the Pi family (`isPi=true`) the gate short-circuits and returns an
empty MCP list **before** `toAcpMcpServers` runs, and without logging (the not-delivered log is
gated on `!isPi`). So a `pi_core` run with a user `mcp_servers` entry (stdio OR http) returns HTTP
200 with the model improvising, no MCP tool delivered, and no log line. Even a stdio server that
"fails loud" on Claude is silently dropped on Pi. Live: both an stdio entry (with a `command`) and
an http entry returned 200 with no MCP delivery and no log; the only `internal tool MCP server`
log lines in the window belonged to Claude gateway-tool runs.

**Why it matters.** The config surface accepts `mcp_servers` for every harness; the Pi family
silently ignores them with zero signal — worse than the Claude path, which at least logs the drop
and fails loud on stdio. The new HTTP-MCP-enabled capability (a real change since matrix rule 8,
which said "http MCP is skipped this release") is Claude-only and cannot be exercised live here
because Claude is credential-blocked (F-019).

**Repro.** `POST /invoke` harness `pi_core` with `mcp_servers:[{name, transport:"stdio",
command:"node", args:[…]}]` or `{transport:"http", url:"https://…"}` → 200, no MCP delivery, no log.
Captures: `runs/E2_2026-06-25__INV2_mcp_stdio_pi_core.json`,
`runs/E2_2026-06-25__INV2_mcp_http_pi_core.json`.

**What to do.** At minimum log the drop for the Pi family too (move the not-delivered log out of the
`!isPi` guard), and decide whether to hide/warn `mcp_servers` in the config when the harness is
`pi_core`/`pi_agenta`. The HTTP-MCP-delivery and stdio-fail-loud cells (Claude) stay
`blocked:anthropic-key` (F-019) until a project-scoped Anthropic key is available.

### F-033 Missing-key error is correctly attributed in the playground (PASS), but the agent stream error also trips the Next.js dev Runtime Error overlay

**Status:** open (content PASS; the dev-overlay trip is a dev-mode observation, not a prod bug)
**Severity:** minor
**Triage:** small-fix (catch the `useChat`/stream error so it does not bubble to the dev overlay);
the content side needs no action
**Added:** 2026-06-25 (FE playground sweep, merged big-agents)
**Commit:** `gitbutler/workspace` (v0.104.2)
**Found in:** FE playground (logged-in user, Default project), harness `pi_core` (Pi),
model `gemini/gemini-2.5-flash`, capability error-in-UI

**The test.** The Default project vault has exactly two provider keys — `openai` and `anthropic`
(confirmed via `GET /api/vault/v1/secrets/?project_id=…` as the logged-in user: count 2, kinds
[openai, anthropic]). Selecting a **Gemini** model (no Gemini key) and sending a message safely
forces a missing-key error without touching any existing key.

**Result — content PASS.** The in-chat error surfaces clearly and **names the right provider that
was called**: an alert "**Stream error — Agent run failed: pi_core: model authentication failed —
add the project's Gemini key to the project vault, or log in (OAuth).**" The chat row also shows
"No response — the agent ended its turn without answering." So per-provider credential resolution
correctly identifies Gemini (not a generic "add your key" message) and the UI attributes the
failure to the exact provider called. This is F-017's fail-loud work visible end to end on the FE.

**Dev-mode caveat.** The same stream error ALSO popped the Next.js dev **Runtime Error** overlay
(full-screen modal with the same text and a Call Stack → `new Promise <anonymous>`), with console
errors `[AgentChatPanel] useChat error: Error`. The agent stream error is thrown unhandled, so in
`--dev` it trips the Next.js overlay on top of the (correct) in-chat alert. A production build has
no dev overlay, so the in-chat alert is the only surface and it is correct. Same dev-mode footgun
class as the prior FE notes; the small fix is to handle the `useChat` error in `AgentChatPanel`
(`web/oss/src/components/AgentChatSlice/...`) so it renders only as the in-chat alert.

**Repro.** Default project, Pi harness, pick `gemini/gemini-2.5-flash` (no Gemini key), send any
message. Expect the in-chat "Stream error" alert naming Gemini (PASS) plus, in dev, the Next.js
Runtime Error overlay (caveat).

### F-034 FE playground re-verification summary (merged big-agents v0.104.2) — what is GREEN

**Status:** informational (pass record for this sweep)
**Severity:** n/a
**Triage:** n/a
**Added:** 2026-06-25 (FE playground sweep, merged big-agents)
**Commit:** `gitbutler/workspace` (v0.104.2)
**Found in:** FE playground, logged-in user, Default project

Re-ran the playground surface as the logged-in user (the SDK `/invoke` key is hotel-agent-bound
and cannot see the Default vault — F-019; the browser runs as the user with Default selected, so it
reads the real Default vault: OpenAI + Anthropic keys + the `github-w9g` Composio connection).
Cheap models only.

- **Harness picker** shows all three: `Pi`, `Pi (Agenta)`, `Claude Code`. PASS.
- **Model picker filtered per harness.** Pi shows all 8 vault providers (OpenAI 37, Anthropic 12,
  Google Gemini 16, Mistral AI 14, Groq 8, MiniMax 5, Together Ai 15, OpenRouter 23); Claude Code
  shows Anthropic aliases only. Search works (e.g. `flash` → the Gemini `gemini/gemini-2.5-flash*`
  group). Switching harness resets the model to "Select a provider". Matches F-021. PASS.
- **Chat + Pi + Agenta-managed OpenAI** (`gpt-4o-mini`): replied `MODELID-PI-X7: I am a friendly
coding assistant using the Pi coding agent model.` in 322ms, $0.000204. PASS. (Pi does not echo
  the raw model id when asked — expected; the low cost + latency confirm a cheap OpenAI model ran
  via the Agenta-managed Default OpenAI key.)
- **Error-in-UI** (Gemini, no key): correct provider-attributed error. PASS (see F-033).
- **HITL approve prompt renders + Approve resumes** (Claude + haiku + github tool, Ask rules):
  the F-024 auto-deny no longer reproduces; residuals in F-026.
- **Permissions surfaces visible in the form:** Claude shows Permission policy (`Auto`/`Deny`; no
  `Ask` — F-024 note), Sandbox permissions (Network egress / Filesystem / Enforcement), and an
  "Advanced: Claude permissions" panel (Allow/Ask/Deny rules). Pi shows Permission policy +
  Sandbox permissions but no Claude-permissions panel. All three permission layers are present in
  the UI.
- **Tool / MCP / Skills config surfaces present:** Tool picker (gateway + inline code tool), "Add
  MCP server", "Add skill" all render on the form.

Not re-driven to a token this sweep (covered elsewhere or blocked): gateway end-to-end (F-023
PASS last pass), client tools, generative-UI/render tools, custom-connection create+use (the
named-connection picker is "Project default"-only, F-021), MCP-in-UI delivery (Pi drops silently
F-032 / Claude needs the flag+credit). The big change this sweep is HITL (F-026) and the
confirmed-correct error attribution (F-033).

### F-035 Custom-connection cell is not testable from the playground (Connection picker is "Project default"-only); and Pi shows NO Permission policy field

**Status:** open (two related FE coverage facts)
**Severity:** minor
**Triage:** defer (both are known/deferred UX, recorded so the matrix has a home)
**Added:** 2026-06-25 (FE playground sweep, merged big-agents)
**Commit:** `gitbutler/workspace` (v0.104.2)
**Found in:** FE playground, Default project, Connection picker (all harnesses) + Permission
policy field (Pi vs Claude)

**Custom-connection cell blocked on the picker.** The task's "create a dummy custom connection,
run with it, confirm it is used" cannot be exercised from the playground: the **Connection** select
under `Agenta-managed` offers exactly one option, **"Project default"** (`__default__`). There is
no way to select a named/custom connection, so even if a custom provider connection is created in
Settings, a playground run cannot bind to it. This is the deferred named-connection picker (F-021).
I did NOT create dummy vault state, since the run could not consume it and it would only need
cleanup. Mark the custom-connection FE cell `blocked:no-named-connection-picker`.

**Pi has no Permission policy field at all.** Refines the F-024 tail note ("the Pi Permission
policy field only offers auto/deny"). On this stack, with the **Pi** / **Pi (Agenta)** harness the
form shows Harness → **Sandbox permissions** directly, with NO "Permission policy" field rendered.
The Permission policy select (`Auto`/`Deny`, no `Ask`) and the "Advanced: Claude permissions"
panel (Allow/Ask/Deny rules) appear **only for the Claude Code harness**. So the three permission
layers visible in the UI are: (a) Sandbox permissions (Network egress / Filesystem / Enforcement)
for every harness; (b) Permission policy + (c) Advanced Claude Allow/Ask/Deny rules, Claude-only.
HITL via an "Ask" rule is therefore configurable only on Claude, and the Pi family exposes no
tool-permission gate in the form (consistent with Pi's hardcoded `permissionPolicy: auto`).

### F-036 Milestone gate (2026-06-25): Wave-1 fixes re-verified live on merged big-agents (:8280); HITL Deny does not resume; client-tools and gen-UI not consumed by the playground

**Status:** open (one real gap: HITL Deny; two FE consumption gaps: client tools, gen-UI). The
graded Wave-1 fixes are GREEN.
**Severity:** mixed — Deny gap is `major` (HITL is a headline capability); the others are
`minor`/`docs`.
**Triage:** see per-item triage below.
**Added:** 2026-06-25
**Commit:** merged big-agents tip `6324757e86` (working tree HEAD `8bca0391c7`, runner runs the
mounted `services/agent/src` via `tsx`; sandbox-agent restarted to load merged code; `/health`
ok `runner 0.1.0 harnesses [pi_core, claude, pi_agenta]`).
**Found in:** post-consolidation milestone gate. Surfaces: FE playground on :8280 (Default
project, real Anthropic + OpenAI vault keys + `github-w9g` connection), service `/messages` via
authenticated browser fetch, the :8280 sandbox-agent runner `/run` direct (container IP), and the
:8790 subscription sidecar `/run` (Claude OAuth, no API credit).

**Graded results (each Wave-1 fix, live):**

| Fix (commit)                                                          | Result                                                              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HITL prompt enables promptly** (`be881b9ea9` + ToolPart settle fix) | **PASS**                                                            | FE Claude+haiku+github Ask rule: first SSE chunk 434ms, `tool-approval-request` at ~3.9s (model-bound, NOT the old 70-140s); Approve+Deny buttons `disabled:false` the instant the prompt rendered. ToolPart.tsx:76 documents "clickable AS SOON AS the prompt renders … not gated on busy (F-026)".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **HITL Approve → resume**                                             | **PASS**                                                            | Clicking Approve fired a second `/messages` resume; the github tool ran for real (returned the authenticated user) and the turn completed with the forced token `HITL-RAN-9X`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **HITL over-approval anchor** (`be881b9ea9`)                          | **PASS (code) / not driven live**                                   | `approvalKey = toolName#stableArgsHash(args)` (`responder.ts:110`): same call resumes, different args re-prompts; thorough fail-closed handling (non-JSON args → no key → re-prompt; no-arg tools share a key by deliberate trade-off). `extractApprovalDecisions` keys decisions ONLY by name+args, never by bare name or replayed id. Not driven live: the only gated FE tool (github) takes no args, and an inline arg-bearing client tool is not delivered to the model on `/messages` (see client-tools row).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **HITL Deny stops cleanly**                                           | **FIXED (D-022)**                                                   | Was FAIL: Deny recorded `approval-responded` ("Responded") then dead-ended (no resume, no `output-denied`, no continuation). Fixed in lane `fix/agent-hitl-deny-resume` — SDK ingress (`adapters/vercel/messages.py`) now emits the `{approved:false}` `tool_result` envelope for the verbatim inline `approval-responded` part (closes the D-007 cross-layer NOTE), and the FE `agentShouldResumeAfterApproval` predicate resumes on deny-only, so the runner maps deny→reject→tool-error and the model continues.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Claude alias** bare `model:"haiku"` (`3a5124402a`, F-031)           | **PASS (runner) / structured form on the service**                  | `:8790` sidecar `/run` with bare `model:"haiku"` → ran, returned `ALIAS-OK-7Z3`, result `"model":"haiku"` (alias accepted by the runner's `applyModel`, no provider-prefix error). The FE model picker now LISTS the 8 Claude aliases (`default/sonnet/opus/haiku` + `[1m]`). On the SERVICE path the connection resolver still needs a provider, so the FE sends the structured `{model:"haiku", provider:"anthropic"}` (verified end-to-end in the HITL run). Bare `haiku` on the service `/messages` still hits F-017's provider-prefix error — see F-031 residual.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **F-017 bare-model clear error** (`#4846`)                            | **PASS**                                                            | Service `/messages` with a bare model (default `gpt-5.5`) → 500 `"model 'gpt-5.5' needs a provider prefix (e.g. 'openai/gpt-5.5') or a structured {provider, model}; a bare model id can't resolve a credential"`. Clear, actionable; not the old misleading "add your key".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Skill tracing** loaded skills (`3a5124402a`, F-029)                 | **PASS (namespace wrinkle FIXED on `fix/agent-tracing-namespace`)** | Pi (`pi_agenta`) + inline `qa-skill`, trace `fcdf50fb…`: the `invoke_agent` span carries the loaded skills + count. The original run stamped `ag.unsupported.agent.skills.loaded=["qa-skill"]` (demoted to `ag.unsupported.*` because Agenta ingest strict-whitelists top-level `ag.*` keys and `ag.agent` is not one). **Namespace fixed:** the runner now stamps `ag.meta.skills.loaded` / `ag.meta.skills.count` (a recognized free-form `ag.*` bucket), so the attrs land first-class. The skill also appears as its own span (`qa-skill`). **Builtins-in-loaded ROOT CAUSE (NOT a runner bug):** the runner faithfully stamps exactly the materialized `request.skills` it receives; the forced `_agenta.agenta-getting-started` skill is embedded only in the DEFAULT agent config (`@ag.embed` in `services/oss/src/agent/schemas.py`), so a CUSTOM config (the QA `qa-skill` config) drops it and it never reaches the wire. Force-injecting the platform skill for `pi_agenta` regardless of config is a server-side concern (the platform-skill seeding "separate workstream", `harnesses.py`), out of the runner's `otel.ts` scope. |
| **Error tracing** message+provider (`3a5124402a`, F-030)              | **PASS (namespace wrinkle FIXED on `fix/agent-tracing-namespace`)** | Pi + gemini (no key), trace `0a5ba4d7…`: a dedicated `agent_error` span with `status STATUS_CODE_ERROR`, the error message + provider, plus an `exception` event (`exception.type=AgentRunError`). The original run stamped `ag.unsupported.error.message` / `ag.unsupported.error.provider`; the runner now uses the recognized `ag.exception.message` / `ag.exception.provider` namespace, so the diagnostic lands first-class.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Right-provider-on-error** (F-031)                                   | **PASS**                                                            | The stream/HTTP error names the exact provider called: `pi_core: … add the project's Gemini key` (Pi→Gemini), the github gateway path 404s before auth, etc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Pi user-MCP fail-loud** (`c8b4324583`, F-009)                       | **PASS**                                                            | `:8280` runner, `pi_core` + `mcpServers` → `ok:false` `"User MCP servers are not supported on the Pi harness (Pi delivers tools through its bundled extension, not MCP). Use a non-Pi harness (e.g. claude)…"`. No longer a silent 200.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **MCP http SSRF guard** (`c8b4324583`)                                | **PASS**                                                            | `:8280` runner, Claude http MCP: plain `http://…` → `"url must use https"`; `https://127.0.0.1…` and `https://169.254.169.254…` → `"targets an internal/metadata host … not allowed"`. Both the https-required and internal-host blocks fire before auth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Code-tool fail-loud** (F-016)                                       | **PASS**                                                            | `:8280` runner, `pi_core` code tool → `ok:false` error `"Code tools are not supported by the sidecar."` (clean, loud). On Claude the gate surfaces as a `tool_result isError:true` the model reports; the run envelope is `ok:true` because the model recovers, but the error rides the wire (not laundered).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**The Deny FAIL — precise repro + triage.** Fresh single FE conversation, Claude Code + `haiku` +
the github tool with the Ask rule (`harness_kwargs.claude.permissions.ask=["mcp__agenta-tools__github__GET_THE_AUTHENTICATED_USER"]`).
Send "Please look up my GitHub profile using the available GitHub tool." → the `tool-approval-request`
fires, Approve/Deny enabled. Click **Deny**: the buttons vanish, the github tool part settles to
`approval-responded` ("Responded"), the stream is NOT in flight (settled), and the conversation
ends there — NO `output-denied` ("Denied") tag, NO tool-error result, NO model continuation. The
network panel shows only ONE `/messages` request for the whole session (the initial turn); **no
second resume request fired on Deny**, where Approve DID fire a resume in the contrasting run.
Triage: **escalate/fix-now** — the FE `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
(`AgentChatConversation.tsx:83`, `AgentChatPanel.tsx:99`) appears not to re-send on a deny-only
decision, so the denied tool never gets its `{approved:false}` round-trip and the turn deadlocks
in `approval-responded`. Decide whether the deny resume should be driven by the FE (resume so the
runner maps deny→reject→tool-error and the model continues) or whether a deny should short-circuit
to a terminal `output-denied` without a resume. Either way "Deny stops cleanly" is not met today:
it stops, but not cleanly (limbo state, no signal to the user that the tool was refused). NB the
Approve path is fully clean.

**Client tools — NOT consumable by the playground (gap, not regression).** The SDK resolves a
`type:"client"` tool into a `ClientToolSpec` and the egress projects an `interaction_request
kind:"client_tool"` to a Vercel `data-interaction` part (`stream.py`), but (1) an inline client
tool sent on `/messages` is **not delivered to the model** (Claude reports it only has built-ins;
the github _gateway_ tool delivers fine, a client tool does not on this path), and (2) the
playground **renders tool calls but never executes them** — `ToolPart.tsx`: "The FE renders tool
calls; it never executes them." `AgentMessage.tsx` dispatches only `text`/`reasoning`/`tool-*`/
`file` parts; there is no client-tool execution loop and no `data-interaction` handler. So the
"client-executed tool forwarded back to the playground" cell cannot be driven end to end on this
build. Triage: **defer/docs** — record the playground client-tool execution loop as unbuilt; the
wire/egress side exists.

**Generative-UI / render tools — NOT consumed by the playground (gap, not regression).** The
egress emits a `data-render` part for a tool carrying a `render` hint and `data-<name>`/`file`
parts for one-way gen-UI (`stream.py` `_render_part`, `_interaction_parts`). But `AgentMessage.tsx`
has **no `data-render` / `data-*` renderer** — those parts are dropped by the playground UI. So a
render/gen-UI tool would display nothing in the playground today. Triage: **defer/docs** — the
backend/egress supports render hints; the playground does not render them yet.

**Environment notes (not product defects).** (1) The :8790 subscription sidecar mounts
`/pi-agent` read-only, so it logs `pi extension install skipped: EACCES` and a Pi _code-tool_ run
there crashes the stream (`Cannot call write after a stream was destroyed`) instead of the clean
fail-loud; the proper :8280 runner (writable pi-agent, extension built) fails loud cleanly. Use
:8790 only for Claude-OAuth checks, not Pi tool paths. (2) No Daytona was used this pass; no
sandbox was spun up, so nothing to tear down. (3) The `ag.unsupported.*` attribute namespace on
the skill/error trace attrs is a categorization detail (the OTel pipeline buckets custom attrs it
does not recognize); the data is correct and complete.

**Health verdict.** Merged big-agents is HEALTHY and the Wave-1 fixes work live: HITL prompt
timing + Approve/resume, Claude alias, error+skill tracing, right-provider-on-error, Pi-MCP
fail-loud, MCP SSRF guard, code-tool fail-loud, and F-017 are all GREEN. The one real regression-
class gap is **HITL Deny** (records the decision but never resumes → tool stuck in
`approval-responded`). Client-tools and gen-UI are playground-consumption gaps (wire/egress exist;
the UI does not drive them), not regressions.

## Wave-2 re-verification (2026-06-25, big-agents tip `10f4af8b5f`, live :8280 + sidecar :8790)

Post-consolidation milestone gate. Restarted the :8280 sandbox-agent runner + web so they load
the merged tip (both bind-mount `services/agent/src` and run `tsx src/server.ts`, so the restart
reloads the merged code; the runner rebuilt its extension bundle on boot). Cheap models only
(`openai/gpt-4o-mini`, `haiku`); Claude API-direct went through the subscription OAuth sidecar at
:8790; NO Daytona (verified by code/config only).

**Wire renames in the merged tip (not regressions, but breaks the old QA driver):** harness ids
are now `pi_core` / `pi_agenta` / `claude` (was `pi` / `agenta` / `claude`), and the model needs a
provider prefix (`openai/gpt-4o-mini`, not `gpt-4o-mini`) — the strict model gate. The committed
`qa/scripts/run_matrix.py` still uses the old names; update it before the next matrix pass.

**Cell 1 — HITL Deny resume (the headline fix): PASS.** The previous dead-end (deny recorded but
the turn hangs in `approval-responded`) is GONE. Verified at every layer on the merged code:
- FE predicate `agentShouldResumeAfterApproval` (`@agenta/playground`): 9/9, incl. "RESUMES on a
  deny-only decision (the F-036 dead-end fix)" and the approve case.
- SDK ingress `adapters/vercel/messages.py` (`_tool_part_blocks` + `_approval_decision`):
  `test_ui_messages.py` 10/10 — a verbatim `approval-responded` / `output-denied` tool part now
  emits the `{approved}` `tool_result` envelope for BOTH approve and deny.
- Runner `responder.test.ts` (20) + `sandbox-agent-permissions.test.ts` (3): 23/23.
- LIVE against the real merged runner code: `extractApprovalDecisions` + `HITLResponder` on my
  exact two-turn payloads returns `outcome=allow` for approve and `outcome=deny` for deny, keyed by
  name+args (no bare-name over-authorization).
- LIVE two-turn `/run` against the :8790 OAuth Claude sidecar: every turn terminates with
  `done` + `result.ok=true` + a final assistant message — NO hang, NO deadlock on either approve or
  deny. (Caveat: my test gated the Bash builtin via `.claude/settings.json ask`, which Claude Code
  self-resolves to "User refused permission" rather than routing through the ACP reverse-RPC park
  the unit tests cover; it still proves the anti-deadlock property — the turn always completes and
  the model continues. A full FE-driven ACP-park live run needs a credited Anthropic key in the
  Default vault, which is currently absent, so it was not exercised end-to-end through the browser.)

**Cell 2 — tracing namespace: PASS.** Skill attrs land under `ag.meta.skills.loaded` /
`ag.meta.skills.count` and errors under `ag.exception.message` / `ag.exception.provider`; the
runner test `otel-skills-error.test.ts` (7/7) explicitly FORBIDS `ag.unsupported.*` (and
`ag.agent.*` / `ag.error.*`). LIVE: a real Claude auth-failure run (trace
`949ec00388df6798cafaaaf4e413de4f`) carries `ag.exception.message = "claude: model authentication
failed …"` on the `invoke_agent` span with NO `ag.unsupported.*`; a successful pi_agenta run trace
also has NO `ag.unsupported.*`. (The plain OTel `exception.*` event coexists on the workflow span —
that is the standard SDK-recorded exception, separate from the recognized `ag.exception.*` bucket.)

**Cell 3 — no regression (backend LOW batch): PASS.** Normal runs still work on the merged tip:
pi_core chat, pi_agenta chat, and pi_agenta builtin-bash all return 200 with the forced token
(`PONG-WAVE2-7Q`, `QA-BASH-x86_64`). `enforcement` omitted defaults to `strict` (dtos.py /
wire_models.py) and did not break anything; the runner auth header (`Authorization` in
tracing.py) is unset by default and fine. The dead `prompt` field is gone from
`services/oss/src/agent/dtos.py`. (A code-tool run returns the deliberate guard "Code tools are not
supported by the sidecar" on the local engine — a pre-existing local-engine constraint, NOT a
Wave-2 regression.)

**Cell 4 — Daytona TTL: PASS (code/config only, no sandbox spun).** `provider.ts`
`buildDaytonaCreate` sets `autoStopInterval: daytonaAutoStopMinutes()` (from
`SANDBOX_AGENT_DAYTONA_AUTOSTOP_MINUTES`, default 15, clamped >= 1) alongside `ephemeral: true`, so
the wrapper's hardcoded `autoStopInterval: 0` is overridden (our create object spreads after it).
`sandbox-agent-provider.test.ts` (14/14) pins it: default >= 1, env value honored (42), `0`/negative
clamp to the default. The deployment env file does not set the var, so the 15-minute default
applies. Daytona hygiene: live sandbox count = 0 before and after; I spun NOTHING on Daytona (all
runs used `sandbox: local`), so there was nothing to tear down.

**Health verdict.** big-agents is HEALTHY with Wave-2 in. The headline HITL Deny dead-end is FIXED
across FE predicate + SDK ingress + runner responder (all green live), the tracing namespace is
correct (`ag.meta.skills.*` / `ag.exception.*`, never `ag.unsupported.*`), no regression from the
backend LOW batch, and the Daytona auto-stop TTL backstop is in place. Only follow-ups: update the
QA driver for the `pi_core`/`pi_agenta` + provider-prefix renames, and (if a fully browser-driven
ACP-park Claude HITL run is wanted) add a credited Anthropic key to the Default vault or wire the FE
to the :8790 sidecar.

## How to add a finding during a run

Copy the F-001 block, bump the id, and fill every field. Required: the environment, harness,
and capability the defect showed up in; the exact repro (the request body or the script and
the message sent); what you expected and what you got; and the triage call with one line of
why. If you cannot write a clean repro, the finding is not ready to hand off. Capture the
raw request and response under `qa/runs/` and link it.

### F-037 (FE sweep 2026-06-26) Web container restarted with the no-port default env file → all browser API calls hit port 80 → app bounces to /auth (FE totally unreachable)

**Status:** RESOLVED in this stack (recreated web with the correct env file). Recurrence-prone.
**Severity:** major (blocks ALL browser-driven FE QA until fixed)
**Triage:** environment/deployment config (not product code). Fix-now applied.
**Added:** 2026-06-26 (overnight FE sweep)
**Commit:** big-agents tip `80760a3329` (running stack v0.104.2)
**Found in:** FE playground, IP origin `http://144.76.237.122:8280`, Default project.

**Symptom.** Loading any authenticated page (e.g. `/apps`) flashed and then redirected to
`/auth`, with a Next.js dev "Runtime TypeError: Failed to fetch" overlay. The session cookies
(`st-access-token`, `sFrontToken`) were present and valid.

**Root cause.** The `web` container had been recreated ~7 min before the sweep WITHOUT
`ENV_FILE=./.env.ee.dev.local`, so it loaded the compose default `./.env.ee.dev`, which carries
the no-port URLs: `AGENTA_API_URL=http://144.76.237.122/api`, `AGENTA_WEB_URL=http://144.76.237.122`,
`DOMAIN_NAME=http://144.76.237.122`, `AGENTA_PORT=80`. The browser loads the SPA from the
`:8280` origin (traefik maps `8280->80`) but the FE issues API calls to the absolute
`AGENTA_API_URL` = `http://144.76.237.122/api` (port 80). Port 80 of the box is served by a
DIFFERENT stack/traefik and 404s every `/api/*` call (`net::ERR_FAILED` on `/api/profile`,
`/api/workflows/query`, `/api/projects`, …). A failed `/api/profile` is read as "not
authenticated" → redirect to `/auth`. The `api`/`services`/`traefik` containers still had the
correct `:8280` URLs (they were untouched), so only `web` was broken.

**Repro.** `docker restart agenta-…-web-1` (or `docker compose restart web` / a `up -d web`
without `--env-file ./.env.ee.dev.local`) → reload `/apps` → bounce to `/auth` + "Failed to
fetch". `curl http://144.76.237.122/api/health` → 404; `curl http://144.76.237.122:8280/api/health`
→ 200.

**Fix applied.**
`ENV_FILE=./.env.ee.dev.local TRAEFIK_PORT=8280 docker compose -p agenta-ee-dev-wp-b2-rendering`
`--env-file ./.env.ee.dev.local -f docker-compose.dev.yml --profile with-web up -d`
`--force-recreate --no-deps web`. After recreate the web env carries the `:8280` URLs, `/apps`
loads authenticated, `/api/profile` (via :8280) is reachable. This is the same class as F-020
("playground unreachable on the origin").

**Prevention note for operators.** Always recreate `web` with `ENV_FILE=./.env.ee.dev.local`.
A bare `docker restart`/`compose restart` is safe (keeps env), but a `compose up -d web` without
the env file silently reverts to the broken default. Consider making `.env.ee.dev` carry the
`:8280` URLs for this box, or pin `ENV_FILE` in the compose project's `.env`.

### F-038 The batch JSON paths (`/invoke` AND `/messages` JSON) collapse every runner `ok:false` to a generic "Agent runner HTTP 500"; only the `/messages` SSE path surfaces the actionable message

**Status:** open
**Severity:** minor (observability/UX; the trace + the SSE path still carry the full text, so
it is recoverable, but a batch caller gets nothing actionable)
**Triage:** defer (the discard is deliberate — `ts_runner.py` logs the body, does not surface
it, "the response body can carry internal detail" — so changing it is a decision about what is
safe to return to a caller, not a one-line bug)
**Added:** 2026-06-26 (SDK-surface overnight sweep)
**Commit:** big-agents tip `80760a3329` (running stack v0.104.2; runner + services bind-mount the
working tree)
**Found in:** E2 sandbox-agent local, service `/invoke` and `/messages` (both JSON and SSE),
every runner-`ok:false` case (missing-key auth fail, the F-016 code-tool gate, the F-038-adjacent
sandbox-permission gates, bare-Claude-alias-then-no-key)

**The problem.** When the runner refuses or fails a run it returns `{ok:false, error:"<actionable
message>"}` at **HTTP 500** (`services/agent/src/server.ts:52` — `result.ok ? 200 : 500`). The SDK
transport `deliver_http` (`sdks/python/agenta/sdk/agents/utils/ts_runner.py:62`) treats any `>=400`
as a transport failure and raises `RuntimeError("Agent runner HTTP 500")`, logging the body but
NOT surfacing it (by design: "the response body can carry internal detail, so it is logged, not
surfaced"). So the service `status.message` is the generic `"Agent runner HTTP 500"` on BOTH the
`/invoke` batch path and the `/messages` JSON (batch) path. The `/messages` SSE (streaming) path is
different: it emits a Vercel `error` part with the full text, e.g.
`{"type":"error","errorText":"Agent run failed: pi_core: model authentication failed — add the
project's Gemini key to the project vault, or log in (OAuth)."}`. So error-message fidelity depends
on the **transport (streaming vs batch)**, not the route.

**Why it matters.** A batch caller (the most common SDK/API usage of `/invoke`) gets "Agent runner
HTTP 500" with no provider, no reason, no remediation — even though the runner produced a clear,
provider-named message. The FE works because it streams (gets the SSE `error` part). Note this is
NOT the same as the resolver-level F-017 fail-loud, which DOES surface a clean top-level
`status.message` ("model 'gpt-4o-mini' needs a provider prefix …") because that error is raised in
the Python service BEFORE the runner call; the collapse only affects errors that originate in the
runner and come back over HTTP 500.

**Repro.** `POST /invoke` (or `/messages` with `Accept: application/json`) `pi_core` +
`gemini/gemini-2.5-flash` (no Gemini key) → `status.code 500`, `status.message "Agent runner HTTP
500"`. The SAME cell via `/messages` with `Accept: text/event-stream` → an `error` part naming
Gemini. Trace (any path): `ag.exception.message` / `ag.exception.provider` carry the full text
(F-030 — so observability is intact regardless).

**What to decide or do.** Decide what a batch error response should carry. Options: (1) have the
runner return the `ok:false` body at a 2xx (or a 422) so `deliver_http` parses it and the service
maps `error` into `status.message`; (2) have the service surface a curated, safe subset of the
runner error (the provider-named auth message and the boundary-gate messages are already
user-safe — they are the same text the SSE path emits). The trace already carries the full
diagnostic, so this is purely about the batch HTTP response. Keep the "don't leak internal
stacktraces" intent; the gate/auth messages are not internal.

### F-039 Service silently strips ALL user MCP servers when `AGENTA_AGENT_ENABLE_MCP=false`, so the runner's fail-loud MCP guards never fire via `/invoke` or `/messages`

**Status:** open
**Severity:** minor (the runner guards are correct and green when reached; this is a
service-layer silent-drop that masks them on the default deployment config)
**Triage:** defer (decide whether the service should warn/echo when it drops `mcp_servers`, and
whether the deployment should keep MCP off by default — both are config/UX decisions)
**Added:** 2026-06-26 (SDK-surface overnight sweep)
**Commit:** big-agents tip `80760a3329`
**Found in:** E2 sandbox-agent local, service `/invoke` and `/messages`, capability MCP (stdio +
http), every harness
**Source:** `services/oss/src/agent/tools/resolver.py` `resolve_mcp_servers` returns `[]` (no log)
when `_mcp_enabled()` is false; the deployed services container has `AGENTA_AGENT_ENABLE_MCP=false`.

**The problem.** The runner-level MCP guards on this tip are all CORRECT when called directly
(verified against the working-tree `:8765` runner via its container IP):

- Pi + any user MCP (stdio OR http) → `ok:false` "User MCP servers are not supported on the Pi
  harness (Pi delivers tools through its bundled extension, not MCP). Use a non-Pi harness …".
- Claude + http MCP plain `http://` → `ok:false` "http MCP server url must use https".
- Claude + http MCP internal/metadata host (`169.254.169.254`) → `ok:false` "targets an
  internal/metadata host … not allowed" (SSRF guard).
- Claude + user stdio MCP → `ok:false` "MCP servers are not supported by the sidecar." (stdio
  refused even on Claude).

BUT through the service (`/invoke`, `/messages`) NONE of these fire, because
`resolve_mcp_servers` strips the whole `mcp_servers` list to `[]` BEFORE the run when
`AGENTA_AGENT_ENABLE_MCP=false` (the deployed default). The run then proceeds HTTP 200 with no MCP
delivery and no signal. So a user who sends `mcp_servers` to the service on this deployment gets a
silent no-op — the F-032 class — even though the runner is fully capable of failing loud. The
runner's guards are reachable only by calling `:8765` directly.

**Repro.** `POST /messages` (SSE) `pi_core` with `mcp_servers:[{name,transport:"stdio",command:
"node",args:[…]}]` → normal 200 stream, no MCP, no error, no log (service stripped it). The SAME
payload to the runner `:8765` directly → `ok:false` with the Pi-specific message above.

**What to decide or do.** (1) At minimum, the service should LOG (and ideally warn on the wire)
when it drops `mcp_servers` because MCP is disabled, rather than silently emptying the list. (2)
Decide whether MCP should be enabled by default on the deployment (the runner guards make it safe
— stdio refused, http https-only + SSRF-guarded), so the loud runner behavior is what a user
actually sees. (3) Even with MCP enabled, the Pi-family fail-loud guard is the right behavior; the
service should not pre-empt it by stripping. As-is, the headline MCP capability (and its
fail-loud safety) is invisible from the only entrypoints a user has.

### F-040 (FE sweep 2026-06-26) HITL on Claude+github (Ask rule): prompt+buttons PASS, but Approve hangs and Deny ends in "The agent run failed" — both correlate with a runner ACP socket-close

**Status:** FIXED 2026-06-26 — the park now ENDS the `/run` turn gracefully so Approve completes,
Deny ends in a clean denial, and parked turns no longer leak runner sandboxes. Fix +
live proof below ("FIX 2026-06-26"); the original diagnosis is kept underneath for provenance.
**Severity:** major (HITL is a headline capability; the end-to-end FE outcome is broken/ugly)
**Triage:** defer/escalate — needs a runner-log root-cause (ACP write/socket close on resume), not
an obvious one-file FE fix.

**FIX 2026-06-26 (the diagnosed park→terminal approach, shipped + live-verified).**
The single load-bearing change: a HITL `park` now ENDS the `/run` turn instead of holding the
ACP connection open. When the responder returns `park`, an `onPark` callback
(`engines/sandbox_agent/permissions.ts`) fires; the orchestration (`engines/sandbox_agent.ts`)
calls `sandbox.destroySession(session.id)` — the sandbox-agent package's MANAGED cancel, which
resolves the pending permission RPC with `{outcome:"cancelled"}` (NOT a reject → no F-024
clobber) and sends `session/cancel` so the in-flight `session.prompt()` returns. The
orchestration races the prompt against a `parkedSignal` and returns `stopReason:"paused"`, so
(a) the `finally` disposes the sandbox (no leak), and (b) the egress (`vercel/stream.py`) drains
to a clean `finish` frame (`paused`→AI-SDK `other`). The resume then cold-replays as a fresh
turn (#4854 name+args anchor): Approve → tool runs → completes; Deny → the cold-replay returns a
clean "User refused permission" tool-error and the model continues. Point 4 (FE resume carries the
`{approved}` envelope) was already built (#4859 `vercel/messages.py` + `agentApprovalResume.ts`),
verified here.

LIVE PROOF (Claude+haiku, github gateway tool, Ask rule, LOCAL runner, NO Daytona, unloaded):
- Both park turns logged `prompt stopReason=paused` (before: NO stopReason, parked turn alive
  >7 min). 0 leaked `agenta-sandbox-agent-*` dirs measured before/during/after each parked run.
- **Approve** → tool "Responded", a real model-authored final answer (resume completed, no hang,
  no `ERR_ABORTED`).
- **Deny** → tool "Responded", `{"approved":false}` round-tripped, model received "User refused
  permission" and continued with a graceful acknowledgement — **NOT** "The agent run failed".
- Runner logs clean: zero `unhandledRejection` / `ACP write error: other side closed` /
  `fetch failed` (the exact F-040 symptoms, all gone).
Tests: `services/agent/tests/unit/sandbox-agent-orchestration.test.ts` (park emits terminal
`paused` even when the prompt hangs; no-leak; park terminates even if the managed cancel rejects)
+ `sdks/python/oss/tests/pytest/unit/agents/adapters/test_vercel_stream_park.py` (parked stream
drains to a `finish` with `finishReason:"other"`). Codex-reviewed (verdict: design right; folded
its 3 fixes — dropped the dead `session.destroySession`, mapped `paused` explicitly, added the
cancel-rejects test).

---

ORIGINAL DIAGNOSIS (kept for provenance):
**Added:** 2026-06-26 (overnight FE sweep)
**Commit:** big-agents tip `80760a3329` (v0.104.2), runner runs mounted `services/agent/src` via tsx.
**Found in:** FE playground, Default project, committed Agent app `019efe38-929b-7962-a85a-7628bd033283`
(Claude Code · haiku, Agenta-managed Anthropic, github gateway tool, Ask rule
`harness_kwargs.claude.permissions.ask=[mcp__agenta-tools__github__GET_THE_AUTHENTICATED_USER]`).

**What PASSES (live FE):**
- The HITL **prompt renders promptly** with **Approve/Deny** enabled the moment it appears (no
  70-140s hang — F-026 timing fix holds). The gated tool shows "Awaiting approval" → "Run this tool?".
- **Approve fires a second `/messages` resume** (reqid 3863) — the resume mechanic works.
- **Deny does NOT deadlock.** After Deny the tool settles to **"Responded"** (NOT stuck in
  "approval-responded" limbo) and the run **terminates** (spinner clears, input re-enabled). This is
  the core #4859 fix and it holds: no hang, no dead-end.

**What FAILS (live FE):**
- **Approve → no completion.** After Approve the tool shows "Responded" with INPUT `{}` but **no
  OUTPUT block and no final assistant answer** for ~5 min; the resume stream ended `net::ERR_ABORTED`.
  The token `4d7e91ab` + the github login never arrived. (Contrast: F-036 reported Approve "fully
  clean" returning the authenticated user + token — this run did not reproduce that.)
- **Deny → "The agent run failed".** After Deny the run terminates but the terminal UI shows a red
  **"The agent run failed. The agent run failed."** error, NOT a graceful model message ("I couldn't
  do that because the tool was denied"). So Deny is no-deadlock (good) but not a clean acknowledgement
  (the task's "terminates cleanly" is met on no-deadlock; the UX is a raw failure).

**Correlated runner signal.** `docker logs …-sandbox-agent-1` shows repeated
`[sandbox-agent] unhandledRejection: TypeError: fetch failed` / `ACP write error: TypeError: fetch
failed  [cause]: SocketError: other side closed` — the runner's ACP write back to the harness fails
when the resume stream closes. Both the Approve hang and the Deny "agent run failed" plausibly share
this resume/socket root cause. NB this was a single FE pass on a slow model (haiku) + a real Composio
gateway call; a re-run + a focused runner-log trace correlation is needed before calling Approve a
hard regression. The model-resolution, Ask-gate firing, prompt timing, and Deny-no-deadlock are all
confirmed; the gap is the post-decision completion.

**Repro.** Open app `019efe38-929b…` playground (Claude+haiku, github tool, Ask rule already set).
New chat tab → "Please look up my GitHub profile using the available GitHub tool…<token>". At "Run
this tool?" click Approve (hangs ~5 min, resume ERR_ABORTED) or Deny (settles to "Responded" then
"The agent run failed"). Trace for the Approve run: `0cf2e9506df527cba31192b9fe16bce9`.

**UPDATE 2026-06-26 — CLEAN RE-RUN on an UNLOADED runner (local backend, NO Daytona): REAL BUG
confirmed, NOT a concurrency artifact.** Verified the runner carried only this one run (2 turns; no
concurrent load). Live FE repro (Claude+haiku, github tool, Ask rule, token `F040RUN1`): the HITL
prompt rendered fast with Approve/Deny enabled (PASS), I clicked Approve → tool settled to
"Responded" with INPUT `{}`, **no OUTPUT, no final answer**, and after a few minutes the chat showed
"The agent run failed. The agent run failed." (FE `[AgentChatPanel] useChat error`).

ROOT CAUSE (multi-layer, with live evidence):
1. **The park turn never terminates on the runner.** On the `/messages` path the responder returns
   `park` and sends NO `respondPermission` (`engines/sandbox_agent/permissions.ts:46`), so
   `session.prompt()` (`engines/sandbox_agent.ts:428`) blocks indefinitely waiting for the human. The
   runner has NO "park terminal record" — it relies on the prompt resolving. Claude does NOT end the
   turn on an unanswered gate. LIVE PROOF: the parked runner turn (`harness=claude` cwd
   `…-PLSZKP`, started 00:37:30) logged NO `stopReason` and its temp sandbox dir stayed alive >7 min,
   even after I reloaded the browser tab. The `headersTimeout` fix (`acp-fetch.ts`, timeouts disabled
   = 0) makes the parked ACP connection effectively immortal, so the park outlives everything.
2. **The egress never emits a `finish` frame for a parked turn.** `vercel/stream.py` does
   `async for event in run`; on `interaction_request` it yields the approval part and keeps iterating,
   but the runner sends no further NDJSON line and no `done`, so the loop blocks and the post-loop
   `finish` frame (stream.py ~L186-198) is never reached. The FE SSE stays open; the FE re-enables
   input optimistically off the approval part, but the original turn's stream is hung.
3. **The resume can't complete against the hung stream.** The AI SDK fires the resume POST
   (`sendAutomaticallyWhen: agentShouldResumeAfterApproval`) while the parked stream is still open; the
   orphaned park lingers and the resume errors out on the FE (`useChat` onError →
   `AgentChatPanel.tsx:160`), surfacing "The agent run failed". The `ACP write error: SocketError:
   other side closed` (`acp-http-client` `postMessage` → `failReadable`) is the daemon teardown when a
   parked connection is finally force-closed; it is a SYMPTOM of the orphaned-park teardown, not the
   primary cause. NB the agent-service→runner httpx `AGENTA_AGENT_RUNNER_TIMEOUT_SECONDS=180`
   (`adapters/sandbox_agent.py:131`) did NOT cleanly reap the parked turn either.
4. **A secondary contract gap (older capture):** a prior-session resume request body
   (`/messages` reqid 3863) carried ONLY the user text — no `tool_result {approved}` block — so even a
   resume that DOES reach the runner can fail `extractApprovalDecisions` and re-park. The egress
   `vercel/messages.py:136` IS supposed to convert an inline `state:"approval-responded"` tool part
   into the `{approved}` envelope; whether the FE always includes that responded tool part on resume
   needs a FE check (`AgentChatSlice` / `agentApprovalResume.ts`).

SIDE EFFECT: orphaned parked turns LEAK runner temp sandboxes (6 `…-sandbox-agent-*` dirs accumulated;
cleaned up). The `finally` cleanup in `sandbox_agent.ts` only runs when the prompt settles, which never
happens for a park.

PROPOSED FIX (diagnose-only; orchestrator dispatches):
- **Make a park END the turn gracefully.** When the responder returns `park`, the runner must finish
  the current `/run` stream cleanly: emit the `interaction_request` event, then a TERMINAL result
  record (e.g. `stopReason:"paused"` / a `park` terminal) and let `session.prompt()` /the engine return
  so the `finally` disposes the sandbox. The egress then emits a proper `finish` frame so the FE stream
  closes and the resume starts fresh (cold-replay), exactly as the cross-turn HITL design intends. This
  removes the immortal-park, the leak, and the "no finish frame" hang in one move.
- **Ensure the resume carries the decision:** confirm the FE includes the `approval-responded` tool
  part (not just user text) on the resume POST so `vercel/messages.py` emits `{approved}` and
  `extractApprovalDecisions` resolves the gate (fixes the "approved:false"/re-park variant).
- A graceful park-end also lets Deny return a clean denial message instead of "agent run failed".

### F-041 (FE sweep 2026-06-26) FE matrix scoreboard — what is green on big-agents v0.104.2

**Status:** informational (pass/fail record for the 2026-06-26 autonomous FE sweep)
**Severity:** n/a
**Added:** 2026-06-26 (autonomous overnight FE sweep, logged-in user, Default project, :8280 IP origin)
**Commit:** big-agents tip `80760a3329` (v0.104.2). Cheap models only (gpt-4o-mini, haiku).

Ran as the logged-in user (`resiros`) on the Default project (real OpenAI + Anthropic vault keys +
`github-w9g` Composio connection) against the committed Agent app `019efe38-929b…`. The Anthropic
blocker (F-019) is cleared for the Default project: Claude+haiku runs real.

| Cell | Result | Evidence |
| --- | --- | --- |
| #4862 Prompts→Agent create menu | PASS | "New prompt" submenu = Chat/Completion/**Agent**; opens agent draft drawer |
| Harness picker (3 harnesses) | PASS | Pi / Pi (Agenta) / Claude Code listed; switching updates header + wire id |
| Model picker filtered per harness | PASS | Pi shows 8 providers (OpenAI 37/Anthropic 12/Gemini 16/Mistral 14/Groq 8/MiniMax 5/Together 15/OpenRouter 23); harness switch resets model |
| Pi + Agenta-managed OpenAI chat (Mo-01) | PASS | gpt-4o-mini, $0.000479, real run |
| Claude + Agenta-managed Anthropic chat (Mo-02) | PASS | "I'm Haiku 4.5" + token `8c2d5a71`, $0.011413 |
| Gateway tool (Composio github) on Pi | PASS | real `mmabrouk` profile + token `3e72c1a8`; full tool-card INPUT/OUTPUT render |
| D-016 forced `_agenta` skill (#4866) | PASS | trace `skills.loaded=["agenta-getting-started"]` with form Skills=None |
| Skills visible in trace | PASS | `skills.loaded`/`skills.count` present |
| HITL prompt renders + buttons enable promptly | PASS | Approve/Deny enabled on render, ~seconds not 70-140s |
| HITL Approve fires resume | PASS | second `/messages` (reqid 3863) on Approve |
| HITL Deny — NO DEADLOCK (#4859 core) | PASS | Deny → tool "Responded", run terminates, input re-enabled, no limbo |
| HITL Approve completion (Claude) | **PASS** (F-040 fixed 2026-06-26) | park ends `paused`, resume completes with a real model answer, no hang/ERR_ABORTED, no leaked sandbox |
| HITL Deny terminal UX (Claude) | **PASS** (F-040 fixed 2026-06-26) | tool "Responded", clean "User refused permission" → model continues; NO "agent run failed" |
| Missing-key error in UI (right provider) | PASS | "pi_agenta: model authentication failed — add the project's Gemini key…" names Gemini |
| Run error does NOT crash page (#4865) | PASS | inline error, playground intact, NO Next.js overlay, ZERO console errors |
| #4861 stream/batch switch | PASS (prior-verified) | streaming confirmed live this pass; toggle UI not located in this view |
| All 3 permission layers visible (F-035) | PASS | Sandbox perms (all harnesses); Permission policy + Claude Allow/Ask/Deny (Claude-only) |
| Custom connection create+use (Cn-01..03) | blocked | no named-connection picker (F-035); "Project default" only |
| Client tools / gen-UI render | not re-driven | known FE-consumption gaps (F-036), wire/egress exist |

**Blocker fixed first:** F-037 (web container on the no-port default env file → all `/api/*` hit
port 80 → bounce to /auth). Recreated `web` with `ENV_FILE=./.env.ee.dev.local`.

### F-042 (Daytona E3 sweep 2026-06-26) #4853: gateway/callback tools are NOT delivered to the Claude harness on Daytona (loopback skipped, but no in-sandbox advertisement replaces it)

**Status:** OPEN — real defect on the #4853 KEY cell. Loopback-skip half is correct; the
file-relay *delivery* half does not reach Claude on Daytona.
**Severity:** major (the headline #4853 cell — Claude + gateway tool + Daytona — does not work).
**Triage:** DEFER (no fix per task). Fix needs a Claude-side in-sandbox tool-advertisement
shim for Daytona (design decision; spans runner + sandbox image), so it is not a fix-now.
**Added:** 2026-06-26 (autonomous overnight Daytona E3 sweep)
**Commit:** workspace tip `407635ca01` (contains big-agents `80b2748f56`)
**Found in:** E3 (service / sandbox-agent Daytona), harness `claude`, capability gateway/callback tool.

**What #4853 fixed (verified correct).** On Daytona the internal gateway-tool MCP channel must
NOT be advertised over the runner loopback (`127.0.0.1`), because the harness runs IN the remote
sandbox where `127.0.0.1` is the sandbox's loopback, not the runner's. `mcp.ts`
`buildSessionMcpServers` correctly skips the loopback channel when `isDaytona` and logs
`daytona: 1 gateway tool(s) delivered via the file relay, not a loopback MCP URL`. CONFIRMED in
the runner log on every Daytona Claude run with a tool.

**The gap.** Skipping the loopback removes Claude's ONLY tool-advertisement channel on Daytona.
The "file relay" (`tools/relay.ts` `startToolRelay`) is purely the *execution* transport: the
runner polls the sandbox FS for `<id>.req.json` files and POSTs the resolved callback to
`/tools/call`. Writing those req files (and advertising the tool to the model) is done by the
**Pi extension** (`pi-assets.ts` sets `AGENTA_TOOL_RELAY_DIR`; the bundled `agenta.js` registers
the tools into Pi and writes relay reqs). Claude has NO such in-sandbox shim. So on Daytona,
`sessionInit.mcpServers` is empty for Claude → the model is never told the tool exists → it
cannot be invoked. The runner's "delivered via the file relay" log line is the runner's INTENT,
not a Claude-reachable delivery.

**Live repro (three runs, same callback tool, isolating the variable).** A `callback`-kind
custom tool `get_weather` (callRef `composio.weather.GET_WEATHER`) routed to a local echo server
that returns the unguessable token `RELAY-OK WX9-RELAY-K4P2 city=Berlin` in the `/tools/call`
response shape. Posted directly to the runner `/run` (`:8765`) from inside the sandbox-agent
container; echo server on `127.0.0.1:8999` (reachable from the runner host).

- **Claude + Daytona** → `ok:true` but the assistant replied: "I don't have access to a
  `get_weather` tool. The available tools … are: Agent, Bash, … Write." Echo server NEVER called.
  Runner log: `daytona: 1 gateway tool(s) delivered via the file relay …`. → tool NOT delivered.
- **Claude + LOCAL** (same tool) → reply EXACTLY `RELAY-OK WX9-RELAY-K4P2 city=Berlin`; echo
  server called (`fn=composio.weather.GET_WEATHER city=Berlin`). → loopback MCP delivery works.
- **Pi + Daytona** (same tool, OpenAI key in secrets) → reply EXACTLY
  `RELAY-OK WX9-RELAY-K4P2 city=Berlin`; echo server called. → Pi's extension delivers on Daytona.

So the failure is specific to **Claude × Daytona**: local Claude works, Daytona Pi works, only
Daytona Claude drops the tool.

**Anthropic auth on Daytona (separate, NOW WORKING).** Claude itself runs on Daytona: the
service-resolved `ANTHROPIC_API_KEY` is injected into the remote daemon env
(`daytona.ts` `daytonaSandboxEnv` spreads `...secrets`), so a plain Claude chat + bash builtin on
Daytona PASSED (`CLAUDE-DAYTONA-x86_64`). This clears the old matrix `blocked:daytona-model-auth`
for Claude chat. The gateway-tool gap above is orthogonal to auth.

**Suggested fix direction (not applied).** Claude needs a Daytona equivalent of the Pi extension:
either (a) a small in-sandbox MCP stdio/HTTP shim the runner launches inside the Daytona sandbox
that advertises the resolved tools and writes relay req files, or (b) an in-sandbox process that
proxies the runner's loopback MCP over the sandbox boundary. The relay execution side already
works; only the in-sandbox advertisement is missing for non-Pi harnesses on Daytona.

### F-043 (Daytona E3 sweep 2026-06-26) Daytona-specific fix verification: F-040 HITL no-leak PASS, #4856 TTL+teardown PASS, Claude-auth-on-Daytona now WORKS (matrix scoreboard)

**Status:** informational (pass/fail record for the autonomous Daytona E3 verification run)
**Severity:** n/a
**Triage:** TEST + REPORT only (no fixes applied per task)
**Added:** 2026-06-26 (autonomous overnight Daytona E3 sweep)
**Commit:** workspace tip `407635ca01` (contains big-agents `80b2748f56`). Cheap models only
(gpt-4o-mini for pi, haiku for claude).
**Setup:** `:8280` sandbox-agent runner recreated with the full `.env.ee.dev.local` so the
Daytona config (`SANDBOX_AGENT_DAYTONA_API_URL=https://app.daytona.io/api`, `TARGET=eu`,
`API_KEY`, `SNAPSHOT=agenta-sandbox-pi`) is present; runs forced Daytona per-request via the
`sandbox:daytona` field. A QA-temp `anthropic` provider key was added to the vault for Claude
auth; the Anthropic key was also injected directly via `secrets.ANTHROPIC_API_KEY` for direct
`/run` probes. Composio: NO live connection visible to the test API key (the prior `github-tvn`
/`github-w9g` DB records are gone; the underlying Composio github account `ca__enMAW9gc3rS` is
still ACTIVE under the Default project user but unreferenced), so the gateway cell used a
synthetic `callback` tool routed to a local echo server returning an unguessable token.

| E3 (Daytona) cell | Result | Evidence |
| --- | --- | --- |
| pi_core chat | PASS | forced `PONG` returned; runner `sandbox=daytona prompt stopReason=end_turn`; count→0 |
| pi_agenta chat | PASS | forced `PONG`; count→0 |
| Claude chat (haiku) | **PASS (auth fixed)** | task-framed bash → `CLAUDE-DAYTONA-x86_64`. The service-resolved `ANTHROPIC_API_KEY` is injected into the remote daemon (`daytona.ts` spreads `...secrets`). Clears the old matrix `blocked:daytona-model-auth`. (A bare "echo this token" prompt is refused by Claude Code — model behavior, not a failure.) |
| D-016 forced `_agenta` skill / pi_agenta | PASS | `skills:[]` request still recited the real `agenta-getting-started` headings (`## When to use`, `## Conventions`) from inside the Daytona sandbox; runner log `skills: agenta-getting-started`. The forced-skill union materializes into the Daytona sandbox. |
| **#4853 gateway/callback tool / Claude** | **FAIL** | tool NOT delivered to Claude on Daytona (see F-042). Loopback-skip log fires (`daytona: 1 gateway tool(s) delivered via the file relay`), but Claude reports no such tool and never invokes it. Contrast: SAME tool works on Claude+LOCAL and on Pi+Daytona. Real gap: no Claude in-sandbox advertisement shim for the relay. |
| **#4853 callback tool / Pi (contrast)** | PASS | Pi+Daytona invoked the synthetic `get_weather` → echo `RELAY-OK WX9-RELAY-K4P2 city=Berlin`; the Pi extension delivers + relays on Daytona. |
| **F-040 HITL park / Claude** | **PASS (no leak)** | Claude+Daytona+`.claude/settings.json` ask Bash + `sessionId` (human surface): park turn returned in **7.6s** with `stopReason=paused` + an `interaction_request`; **Daytona count = 0** immediately and after settle — the parked turn's sandbox is disposed (the park-terminal `destroySession` lets the `finally` run). The old >7-min immortal-park leak is gone. |
| **F-040 resume Approve / Claude** | PASS | cold-replay with the exact gate anchor (name=title `"echo F040-DAYTONA-7QX9"`, args=`rawInput`) → `stopReason=end_turn`, gated Bash RAN, `output="F040-DAYTONA-7QX9"`; count→0. (Earlier re-parks were a QA hand-built-anchor error: the gate keys by the ACP title-derived name + `rawInput`, not the bare `Bash`/`Terminal` tool_call name — the real FE/egress builds this anchor via #4854.) |
| **F-040 resume Deny / Claude** | PASS (graceful) | deny envelope `{approved:false}` round-tripped → `stopReason=end_turn`, model received the denial and replied gracefully ("I don't have permission to run that bash command…"), NOT "the agent run failed"; count→0. |
| **#4856 autoStopInterval TTL** | PASS | a live Daytona sandbox caught mid-run reported `autoStop=15` (minutes) — the #4856 backstop overrides the wrapper's hardcoded `0`, so a killed/OOM'd runner cannot leak a sandbox forever (auto-stops in 15 min, `ephemeral:true` deletes on stop). |
| **#4856 finally teardown** | PASS | every normal run's sandbox is `delete`d (not merely STOPPED) by the runner `finally`; the live count returned to 0 after every one of the ~12 Daytona runs in this sweep (before/after asserted each cell). |

**Hygiene note (for future Daytona QA):** the Daytona `delete` is ASYNC and lags the `/run`
HTTP response by a few seconds. A leak-check immediately after a run can transiently read 1; wait
~4-6s and re-list before declaring a leak. Every cell in this sweep settled to 0.

**End state:** 0 Daytona sandboxes remaining (teardown sweep confirmed `REMAINING_LIVE=0`); runner
to be switched back to `local`; `:8280` healthy.

### F-044 Pull broke the live dev api: conflict markers + missing `croniter` dep crash-looped the container (RECOVERED; durable fix pending)

**Status:** open (recovered; durable fix outstanding)
**Severity:** major (dev stack was down ~45 min; new-dep pulls always need `--build`)
**Triage:** fix-now (durable fix = `run.sh --build`; no code change required)
**Added:** 2026-06-26
**Commit:** `329cfa00bb` (big-agents pull that triggered the crash)
**Found in:** live `:8280` EE-dev stack, api container, post big-agents pull
**Source:** live QA sanity run; two independent root causes identified

**The problem.** The `:8280` api container crash-looped for ~45 min after the big-agents pull
(`329cfa00bb`). Two independent causes:

1. **Leftover merge-conflict markers in `api/oss/src/apis/fastapi/tools/router.py`.** The dev
   stack bind-mounts the working tree. During the `but resolve` window, the conflict markers
   left a `SyntaxError` in the live file. Uvicorn `--reload` detected the change and tried to
   reload, but a syntax-errored file cannot be re-imported; uvicorn did NOT auto-recover even
   after the file was corrected on disk. A manual container restart was required.

2. **`ModuleNotFoundError: croniter`.** `croniter>=6,<7` is a new dependency added to
   `api/pyproject.toml` by a commit in this pull. The dev image was built before this dep
   existed; hot-reload cannot install new packages. Every uvicorn worker exited with
   `ModuleNotFoundError` until the package was manually `docker cp`'d into the container venv.

**Recovery already done:** the api container was restarted and `croniter` was injected into its
venv via `docker cp`. `/api/health` returns `{"status":"ok"}`.

**Durable fix outstanding:** `run.sh --build` will rebuild all images (api, runner, sandbox-agent,
services, workers) from the pulled code and install the new dep. Until that rebuild runs, the
hot-patched croniter is ephemeral and any container restart will revert the crash.

**Lesson.** A `but pull` that leaves conflict markers in a bind-mounted file crash-loops the
live api; uvicorn `--reload` does not self-heal after a SyntaxError even when the file is
later corrected. New `pyproject.toml` deps always require `--build` on the dev stack (relates
to the existing dev-api-new-python-dep-rebuild note in MEMORY.md).

### F-045 Pre-redesign agents with a bare-string model 500 on `/invoke` (backward-compat gap; accepted)

**Status:** open (accepted by user; new agents work; old agents need migration or a resolver fallback)
**Severity:** minor (backward-compat; new-agent creation + invocation passes end-to-end)
**Triage:** defer (awaiting user decision: bare-string fallback in the resolver, or a one-time config migration)
**Added:** 2026-06-26
**Commit:** workspace tip post big-agents pull `329cfa00bb`
**Found in:** live `:8280` EE-dev stack, `POST /services/agent/v0/invoke`, pre-redesign agent config
**Source:** live QA sanity run; root-caused in `sdks/python/agenta/sdk/agents/platform/resolve.py:101`
and `services/oss/src/agent/app.py:243` (`_resolve_session_connection`)

**The problem.** An agent saved before the provider/model/auth redesign stores a bare model
string (e.g. `"model": "gpt-5.5"`) in its config. Sending that config to `POST /invoke` now
returns HTTP 500:

```
model 'gpt-5.5' needs a provider prefix (e.g. 'openai/gpt-5.5') or a structured
{provider, model}; a bare model id can't resolve a credential
```

The error is raised at `resolve.py:101` inside `_resolve_session_connection` (the
fail-loud fix from F-017). New agents created via the playground store the structured
`{provider, model}` form and work end-to-end. Old agents stored with a bare string break.

**Root cause.** The F-017 fix correctly made the bare-string no-credential case fail loud
instead of silently degrading. The consequence is that any pre-redesign config carrying a bare
model id now surfaces a 500 instead of a silent auth failure. The /messages→/invoke
consolidation (#4868) is NOT the cause; that consolidation is healthy. This is a
provider/model/auth redesign backward-compat gap.

**What to decide or do.** Two options: (1) add a bare-string→`{provider, model}` fallback
in the resolver (infer provider from the first `/`-separated segment or a model-id→provider
table); (2) run a one-time config migration to rewrite stored bare strings to the structured
form. The user has accepted the current state (new agents must work; old may change).
AWAITING decision.

**Verdict context.** The `/messages`→`/invoke` consolidation is HEALTHY: creating a new agent
and invoking it passes end-to-end. This finding is a separate backward-compat gap from the
resolver redesign.

### F-046 (Claude-subscription sweep 2026-06-27) Reference/workflow tools (#4860/#4877) on Claude: SERVER path PASS, but the tool call PARKS on a HITL gate even with `permission:"allow"` → batch `/invoke` returns HTTP 200 + empty content

**Status:** open (server-side reference-tool execution is healthy; the Claude-harness completion is gated on HITL approval)
**Severity:** major (a Claude agent with a reference tool cannot complete unattended; batch `/invoke` silently returns an empty assistant message)
**Triage:** escalate — orchestrator decides (two questions: should `permission:"allow"` bypass the gate for callback tools on Claude? and should batch `/invoke` return something other than empty content when a tool parks?)
**Added:** 2026-06-27
**Commit:** workspace tip `43dd1086bd` (feat(agent): reference a workflow as a tool via @ag.reference)
**Found in:** live `:8280` EE-dev stack (compose project `agenta-ee-dev-wp-b2-rendering`), harness `claude`, auth = subscription sidecar `agenta-claude-sub-sidecar` (OAuth, `~/.claude` mounted), sandbox `local`, model `haiku`. Scope: Claude-subscription only.

**What works (PASS).**
- **Server-side reference-tool execution (the NEW code):** `POST /api/tools/call` with
  `{data:{function:{name:"workflow.variant.completion-0o1r", arguments:"{\"country\":\"France\"}"}}}`
  → `STATUS_CODE_OK`, content `"The capital of France is Paris."` The `workflow.*` call_ref routed
  to `_call_workflow_tool`, which invoked the referenced workflow revision (a `gpt-4o-mini`
  completion app) and returned its outputs as the tool result. This is the harness-agnostic core
  of #4860/#4877 and it is healthy end-to-end.
- **SDK resolution + delivery to Claude:** a `type:"reference"` tool (`ref_by:"variant"`,
  `slug:"completion-0o1r"`, authored `name`/`description`/`input_schema`) resolves to a callback
  spec and is delivered to Claude as a deferred MCP tool `mcp__agenta-tools__capital_lookup`. The
  sidecar logs `internal tool MCP server ... serving 1 tool(s)`. Streaming the run shows Claude
  reason about the tool, `ToolSearch` to load its schema, then call it with `country=Australia`.

**What is blocked (the gap).** The reference-tool call never executes on the Claude harness in a
single shot. The call PARKS on a HITL approval gate:
- Batch `/invoke` (`Accept: application/json`): HTTP 200, `data.outputs.content == ""` (empty),
  no error. Sidecar logs `prompt stopReason=paused`. `/tools/call` is never POSTed (the workflow
  never runs).
- Streaming `/invoke` (`Accept: text/event-stream`): emits `tool-approval-request` with an
  `approvalId`, then `finish`. Same park.
- Setting per-tool `permission:"allow"` (and the default `permission_policy:"auto"`) does NOT
  suppress the gate — the run still parks. `relay.ts` says `allow` "runs with no prompt", but the
  tool is delivered to Claude as an MCP tool and Claude Code raises an ACP permission request that
  the runner's HITL responder parks; the per-tool `allow` is not propagated to Claude Code's MCP
  pre-authorization (`.claude/settings.json` allowlist), so a gate is always raised. `PermissionPolicy`
  is only `auto|deny` (no allow-all). The completion requires the FE cross-turn approval
  round-trip (the AI-SDK `useChat` resume), which is verified for callback tools in F-040/F-043
  but is not hand-drivable via raw curl (the streaming `/invoke` input is parsed by the loose
  `to_messages`/`Message.from_raw`, not the UIMessage-parts parser, and the cold-replay anchor is
  fragile — a hand-built resume returned `Agent run failed: No user message to send`).

**Net.** Reference tools on Claude work *through the FE approval flow* (server execution proven +
callback approve→execute verified in prior findings), but do NOT complete unattended / in batch
`/invoke`. This is the same callback-tool HITL behavior gateway tools have on Claude; the
reference tool simply inherits it.

**Environment-axis sub-note.** `workflow.environment.production.completion-0o1r` via `/tools/call`
routes correctly but returns a graceful `STATUS_CODE_ERROR "Workflow revision has no runnable
service URL."` — there is no `production` environment deployment of that workflow to exercise the
axis positively. The error path is graceful (tool error, not a 500). Variant axis is the verified one.

**Two sub-observations (not blockers).**
1. Batch `/invoke` returning HTTP 200 + empty content on a parked tool is a poor outcome: no error,
   no signal that approval is needed. A non-streaming caller cannot tell a parked run from an empty reply.
2. The agent-level `connection:{mode:"self_managed"}` *sibling* field is ignored. Connection mode
   must be nested inside a structured `model`: `model:{model:"haiku", connection:{mode:"self_managed"}}`.
   With that shape (and `parameters` nested inside `data`), `self_managed` is honored end-to-end on
   Claude (verified: returned `SM-OK-44`, no vault WARN, no key injected — OAuth). With the
   default `agenta`-no-slug connection and no Anthropic key in the project vault, resolution
   tolerantly degrades to an empty env (no key) and OAuth also works — so the subscription sidecar
   authenticates either way. (Earlier `model 'gpt-5.5' needs a provider prefix` 500s in this sweep
   were a QA request-shape error — `parameters` placed at the top level instead of inside `data`,
   which defaulted the whole agent config — NOT a stripping bug.)

**Claude-subscription sweep scoreboard (2026-06-27, this stack, local sandbox, model `haiku`).**

| Feature | Claude+subscription | Evidence |
|---|---|---|
| Basic chat | PASS | bare `haiku` → `CLAUDE-SUB-QA-7K3Z`; structured `self_managed` → `SM-OK-44` (no key, OAuth) |
| `/inspect` model picker | PASS | `claude`: aliases `default/sonnet/opus/haiku`(+`[1m]`), `connection_modes:[agenta,self_managed]`, `model_selection:alias` |
| Reference tool (server path) | PASS | `/tools/call workflow.variant.completion-0o1r` → "The capital of France is Paris." |
| Reference tool (Claude end-to-end) | BLOCKED (HITL park) | delivered + called by Claude, then `tool-approval-request`/`paused`; `permission:"allow"` does not bypass; batch → empty content |
| Skills | PASS | inline skill, token only in body → Claude returned `SKILL-TOKEN-QV82RP`; sidecar `skills: qa-secret-skill`, `stopReason=end_turn` |
| Gateway tools (Composio) | NOT-TESTABLE | 0 connections in all 4 projects (Default/hotel-agent/demo/pi-agents); not created per scope |
| HITL | PARTIAL | approval gate fires live (`tool-approval-request`); approve/deny round-trip not hand-driven (covered by F-040/F-043) |
| `/tools/discover` endpoint | PASS | `["send a slack message"]` → `SLACK_OPEN_DM` gateway tool + alternatives + `connection.state:needs_auth` + `difficulty:easy` |
| Daytona hygiene | CLEAN | local-only sweep; live Daytona sandbox count = 0 |

**Note on the runner build.** The subscription sidecar container `agenta-claude-sub-sidecar` was
created 2026-06-26 07:58 and was NOT recreated by the fresh deploy, but it bind-mounts
`services/agent/src` read-only, so the runner glue is current repo source (node_modules carries
`sandbox-agent` 0.4.2 baked). The behavior above reflects current code, not a stale build.

### F-047 (Claude-subscription post-merge sweep 2026-06-28) `MCPDisabledError` (and a runner comment) name the WRONG env var — `AGENTA_AGENT_ENABLE_MCP` instead of the gate the code actually reads, `AGENTA_AGENT_MCP_SERVERS_ENABLED`

**Status:** FIXED 2026-06-28 (trivial, safe message correction applied + live-verified).
**Severity:** minor (misleading remediation: a user who follows the error sets a non-existent var and MCP stays off).
**Triage:** fix-now (one user-facing string; no design question, no security surface).
**Added:** 2026-06-28
**Commit:** workspace tip `a496504afb` (gitbutler/workspace; merged Workstream-A state on `:8280`).
**Found in:** E2 sandbox-agent local, service `/invoke`, harness `claude`, subscription sidecar `agenta-claude-sub-sidecar` (OAuth), capability MCP.
**Source:** `sdks/python/agenta/sdk/agents/mcp/errors.py:39` (the `MCPDisabledError` message) and
`services/agent/src/engines/sandbox_agent/mcp.ts:37` (a doc comment). The ACTUAL service gate is
`os.getenv("AGENTA_AGENT_MCP_SERVERS_ENABLED")` (`services/oss/src/agent/tools/resolver.py:24`),
which is also the name the compose files + example envs use
(`hosting/docker-compose/**/docker-compose*.yml`, `env.*.example`).

**The problem.** With MCP disabled (the deployed default), declaring `mcp_servers` now fails loud
(the F-039 silent-strip is fixed) — `POST /invoke` returns the message
`"MCP servers are disabled on this deployment (set AGENTA_AGENT_ENABLE_MCP to enable them) ..."`.
But `AGENTA_AGENT_ENABLE_MCP` is read NOWHERE in the code (grep: only this message + the mcp.ts
comment reference it; the scratch docs perpetuate the same stale name). The real toggle is
`AGENTA_AGENT_MCP_SERVERS_ENABLED`. Empirically confirmed: setting
`AGENTA_AGENT_MCP_SERVERS_ENABLED=true` and recreating the `services` container is what actually
enabled MCP resolution this sweep (the runner then ran the stdio/http guards below); setting
`AGENTA_AGENT_ENABLE_MCP` would have been a no-op.

**Repro.** `POST /invoke` harness `claude` with any `mcp_servers` entry while
`AGENTA_AGENT_MCP_SERVERS_ENABLED` is false → HTTP 500, status names `AGENTA_AGENT_ENABLE_MCP`.

**Fix applied.** Corrected the env-var name in `errors.py` (user-facing) and the `mcp.ts` comment to
`AGENTA_AGENT_MCP_SERVERS_ENABLED`. Live-verified: the re-run message now reads
`"... (set AGENTA_AGENT_MCP_SERVERS_ENABLED to enable them) ..."`. No test asserted the old string.

**Sub-observation (not separately filed).** The service-layer `MCPDisabledError` surfaces as HTTP
**500**, though it is a client config error (declared servers while disabled). A 4xx/422 would read
truer. Left as-is (consistent with the existing runner-error→500 mapping); noted for a future pass.

### F-048 (Claude-subscription post-merge "second QA round" 2026-06-28) Scoreboard — MCP reality + permission ladder on the merged Workstream-A state

**Status:** informational (pass/fail record for the post-merge focused sweep).
**Severity:** n/a
**Triage:** TEST + REPORT (one trivial fix applied — F-047).
**Added:** 2026-06-28
**Commit:** workspace tip `a496504afb` (gitbutler/workspace). Deployment `:8280`, project
`agenta-ee-dev-wp-b2-rendering`. Claude via subscription sidecar `agenta-claude-sub-sidecar`
(OAuth, `~/.claude` mounted, `SANDBOX_AGENT_PROVIDER=local`), `sandbox=local`, model `haiku`.
**Merge provenance note:** the #4888 allow-fix is an ancestor of HEAD; #4896 (disable Claude
Tool-Search) and #4897 (restore real tool args on approval) merges are NOT in HEAD ancestry but
their changes ARE present in the bind-mounted working tree the containers run
(`vercel/stream.py:242` `elif real_input`; `sandbox_agent.ts:137` Tool-Search disable) — GitButler
applies them to the working tree, which is the deployed source. So the merged state is live.

**Headline — do user MCP servers work for Claude on the merged state?**
- **Service default (flag off):** user MCP is DISABLED. Declaring any `mcp_servers` fails loud with
  `MCPDisabledError` (F-039 silent-strip is fixed). HTTP 500. stdio and http both. (F-047: the
  remediation env-var name was wrong; fixed this sweep.)
- **With `AGENTA_AGENT_MCP_SERVERS_ENABLED=true` (flag on, `services` recreated):**
  - **stdio user MCP → FAIL-by-design.** `"Agent run failed: MCP servers are not supported by the
    sidecar."` (`USER_MCP_UNSUPPORTED_MESSAGE`). stdio is intentionally disabled (process-launch on
    the runner host outside the sandbox boundary). Same posture as code tools
    (`"Code tools are not supported by the sidecar."`). This is the intended security stance, not a bug.
  - **http user MCP → WIRED + SSRF-guarded (PARTIAL on positive delivery).** plain `http://` →
    `"http MCP server url must use https"`; `https://169.254.169.254` →
    `"targets an internal/metadata host ... not allowed"`. Both guards fire in `toAcpMcpServers`
    before any credential is attached. The delivery transport is the SAME ACP http-MCP
    (`session.mcpServers` `type:"http"`) the INTERNAL gateway-tool channel uses, which is proven
    executing on Claude (sidecar logs `internal tool MCP server on http://127.0.0.1:.../mcp serving
    1 tool(s)` + tools run). A positive USER-http token round-trip was NOT driven: it needs a
    reachable external https MCP endpoint (or a sidecar `AGENTA_AGENT_MCP_HOST_ALLOWLIST` recreate to
    allow a localhost server) — out of scope to avoid recreating the shared subscription sidecar.
  - **Pi family:** unchanged — user MCP dropped (logged), per F-032 (not re-driven this pass; Claude-only scope).

**Permission ladder (Claude, reference tool `completion-0o1r` delivered as `mcp__agenta-tools__capital_lookup`):**

| Cell | Result | Evidence |
|---|---|---|
| `permission:"allow"` → runs unattended | **PASS** (#4888 holds post-merge) | content `"The capital of France is Paris."`, `Success`, sidecar `stopReason=end_turn` (NO park) |
| `permission:"ask"` → parks for HITL | **PASS** | batch `/invoke` → empty content, `Success`, sidecar `stopReason=paused` |
| `permission:"deny"` → blocked, graceful | **PASS** | content `"DENIED"`, `Success`; tool never executed |
| Reference server-side exec | PASS | `POST /api/tools/call workflow.variant.completion-0o1r {country:France}` → `STATUS_CODE_OK` "The capital of France is Paris." |
| #4897 approve-with-real-args | **PASS (unit + code-present)** | `test_vercel_stream_park.py::test_parked_tool_call_refreshes_real_args_on_approval` green on the merged tree; the `elif real_input` re-emit is in the deployed `vercel/stream.py`. Full live FE approve→execute not re-driven (covered F-040/F-043). |

**Smoke (merged state):**
- **find_capabilities** (platform tool, `default_permission=allow`): PASS. Claude called it
  unattended (`stopReason=end_turn`) → returned best-match `CREATE_AN_ISSUE` (GitHub/Composio) with
  its schema. `/api/tools/discover` healthy.
- **Reference tool**: PASS (see ladder).
- **Claude chat** (subscription sidecar, OAuth, `self_managed`): PASS (`CLAUDE-HAIKU-OK`, `RESTORE-OK`).

**Hygiene.** Daytona NEVER used (sidecar is `provider=local`); live Daytona sandbox count asserted
**0** at end. The `services` container was recreated twice (MCP on for the enabled tests, then back
to off) — env restored to the prior state (`AGENTA_AGENT_MCP_SERVERS_ENABLED=false`,
`AGENTA_AGENT_RUNNER_URL=http://agenta-claude-sub-sidecar:8765`, `AGENTA_API_URL` with `:8280`).
`/api/health` ok; post-restore chat + MCP-fail-loud re-verified.

**Recreate gotcha (for future QA on this stack).** Recreating the `services` container with
`docker compose ... up --no-deps services` MUST export `ENV_FILE=./.env.ee.dev.local`. The compose
`env_file:` directive defaults to `${ENV_FILE:-./.env.ee.dev}` (the no-port file); omitting
`ENV_FILE` injects no-port URLs (`AGENTA_API_URL=http://144.76.237.122/api`) and breaks the auth
middleware's credential-verify (HTTP 404 → `/invoke` returns empty content, status
`Could not verify credentials ... returned ... 404`). Passing `--env-file` alone is NOT enough (it
only feeds `${...}` substitution, not the `env_file:` injection).
