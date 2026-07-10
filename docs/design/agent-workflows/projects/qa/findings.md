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
uses `AGENTA_RUNNER_URL` for the service-to-runner URL. Runner provider settings moved
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

### F-016 run_matrix sent the pre-migration flat agent template; every selector silently fell back to defaults (false-green E3)

**Status:** fixed (driver), open (silent fallback)
**Severity:** major (QA integrity; silent config drop)
**Triage:** fix-now for the driver (done); defer the service-side silent fallback
**Added:** 2026-07-10
**Commit:** lane `chore/qa-driver-wire-shape` (branch `gitbutler/workspace`)
**Found in:** E3 sandbox-agent daytona, harness `pi_core`, capability chat
**Source:** `qa/scripts/run_matrix.py` (request builder); `sdks/python/agenta/sdk/agents/dtos.py`
(`_parse_run_selection` / `_parse_agent_fields`)

**The problem.** The agent template moved to nested sections (`harness.kind`, `sandbox.kind`,
`llm.model`, `instructions.agents_md`); the QA driver still sent the flat pre-migration keys
(`harness`, `sandbox`, `model`, `agents_md`). `from_params` ignores unknown flat keys and falls
back to defaults (`pi_core` / `local` / `gpt-5.5` / no instructions), so an "E3 daytona" run
executed in the LOCAL sandbox and passed. Sidecar logs proved it: session
`f37c4002a3394bddb4a06bb685501007` ran `sandbox=local`, `resolved model=gpt-5.5`. The
before/after sandbox count (0/0) was consistent with "no sandbox ever created", not "cleaned up".

**Why it matters.** A whole environment axis of the QA matrix can go green without ever touching
the environment under test, and a user-supplied config in the old shape degrades silently (the
same silent-drop class as F-001/F-007/F-012/F-015). The reply parser was equally stale
(`outputs.content` vs the current `outputs.messages[]`), masking real replies as failures.

**What was done.** The driver now builds the nested template and parses `outputs.messages[]`;
real E3 runs verified via sidecar logs (`sandbox=daytona`, daytonaproxy ACP traffic).
**Deferred:** make the template parser fail loud (or warn) on unrecognized flat selector keys.

### F-017 E3 pi builtin-bash run breaks the invoke stream after `tunnel discovery failed`; error-path Daytona sandboxes leak until auto-stop

**Status:** open
**Severity:** major (E3 tool runs unusable through the deployed app)
**Triage:** defer (needs the tunnel design; spans runner + services)
**Added:** 2026-07-10
**Commit:** workspace @ b94346f1fc
**Found in:** E3 sandbox-agent daytona, harness `pi_core`, capability builtin bash
**Source:** sidecar log `[sandbox-agent] tunnel discovery failed: fetch failed`; services-side
httpx stream abort → HTTP 500; capture `qa/runs/E3__builtin_bash_pi.json`

**The problem.** With the daemon-carrying snapshot (`agenta-sandbox-pi`), an E3 chat run passes
end to end, but the builtin-bash scenario dies mid-stream: the sidecar logs
`tunnel discovery failed: fetch failed`, ingests the first `tool_call`, then the services-side
stream aborts with an httpx `ReadError` and `/invoke` returns 500. Repro:
`uv run run_matrix.py --env-label E3 --sandbox daytona --only builtin_bash_pi`. Each failed run
left a STARTED sandbox behind (deleted by hand twice; `autoStopInterval` is the only backstop).

**Why it matters.** Chat-only Daytona works, but any tool-using agent on Daytona through the
deployed app fails, and every failure costs sandbox credits until auto-stop kicks in.

**Root cause (2026-07-10, playground repro).** Remote sandboxes reach the file store through the
ngrok tunnel service (compose profile `remote`, `discoverTunnelEndpoint` in
`services/runner/src/engines/sandbox_agent/mount.ts`). The dev box has no `NGROK_AUTHTOKEN` and
the ngrok service is not running, so discovery fails — but instead of the documented
"remote mount is skipped, not fatal", geesefs still starts inside the sandbox against the
unreachable `seaweedfs:8333` and produces a ZOMBIE FUSE mount: registered, never serving. Any
file I/O under it blocks forever with no timeout — a playground run hung eternally on reading
`/home/sandbox/.pi/agent/skills/build-an-agent/SKILL.md`, holding its sandbox (and a second one)
STARTED until deleted by hand. Two sub-defects: (a) the no-tunnel path must skip or fail loud,
never zombie-mount; (b) an in-sandbox mount needs a liveness probe + I/O timeout. Unblocking the
dev box needs an ngrok authtoken in `hosting/docker-compose/ee/.env.ee.dev` and
`--profile remote up -d ngrok`.

**Second layer (2026-07-10, tunnel up).** With ngrok running (`NGROK_AUTHTOKEN` set in
`.env.ee.dev.local`, tunnel verified discoverable from the runner), geesefs inside the Daytona
sandbox now mounts successfully — and then EVERY E3 run fails, including plain chat, with
`Agent run failed: Stream Error`. Timeline is deterministic: geesefs logs "successfully
mounted" at t+7s, but the runner's long-lived toolbox process stream for it dies at t+67s
(`remote mount exit=null` surfaces the t+7s line 60 seconds late), and immediately after,
`workspace mkdir skipped: Stream Error` and ACP `ECONNRESET` — the stream death takes the
sandbox's toolbox/daemon connection with it. Looks like a Daytona proxy ~60s idle-stream
timeout on the quiet geesefs process killing the shared connection; the per-run teardown does
fire on this path (no sandbox leaked across 4 failed runs). Net: without the tunnel, chat works
and file I/O hangs; with the tunnel, mounts work for ~60s and then the whole session dies.
Candidate fixes belong in the runner/sandbox-agent seam (detach or heartbeat the mount process
stream; reconnect toolbox on stream death) — same territory as the sandbox-agent fork plan
(PR #5172). The dev box is left with ngrok UP: fail-fast beats eternal zombie-mount hangs.

## How to add a finding during a run

Copy the F-001 block, bump the id, and fill every field. Required: the environment, harness,
and capability the defect showed up in; the exact repro (the request body or the script and
the message sent); what you expected and what you got; and the triage call with one line of
why. If you cannot write a clean repro, the finding is not ready to hand off. Capture the
raw request and response under `qa/runs/` and link it.
