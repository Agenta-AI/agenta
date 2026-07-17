# Lane F — Harness and platform adapters

## 1. Scope

Read in full: `sdks/python/agenta/sdk/agents/adapters/claude_settings.py` (262),
`adapters/harnesses.py` (173), `capabilities.py` (238), `adapters/agenta_builtins.py` (270),
`platform/workflow.py` (123), `platform/_schema.py` (128), `skills/models.py` (117),
`skills/parsing.py` (90), `skills/wire.py` (20), `skills/errors.py`, `skills/__init__.py`,
`permission_rules.py` (52).

Read for context, not in scope: `interfaces.py` (the `Harness`/`Backend`/`Environment` ports),
the harness-config classes in `dtos.py` (`HarnessAgentTemplate`, `PiAgentTemplate`,
`ClaudeAgentTemplate`, `AgentaAgentTemplate`, `HarnessType`, `HARNESS_IDENTITIES`), `tools/models.py`
(`effective_permission`, `PermissionMode`), `adapters/local.py` and `adapters/sandbox_agent.py`
(`supported_harnesses`), and the matching unit tests under
`sdks/python/oss/tests/pytest/unit/agents/` (`test_harness_adapters.py`,
`test_dtos_harness_configs.py`, `test_harness_identity.py`, `adapters/test_claude_settings.py`,
`connections/test_capabilities.py`, `skills/test_skills_e2e.py`, `platform/test_workflow_resolver.py`,
`platform/test_schema_expand.py`). Read the runner review's executive summary and
`findings/arch-boundaries.md` for reconciliation (section 7 below).

Grepped the whole `sdks/python/agenta/sdk/agents/` tree for harness-name conditionals
(`HarnessType.PI/CLAUDE/AGENTA`, `"claude"`/`"pi_core"`/`"pi_agenta"` literals) to check whether
harness knowledge stays inside `adapters/`, per the brief.

## 2. How it actually works, verified against code

**The harness port.** `Harness` (`interfaces.py:205-259`) is the abstract per-harness wrapper:
`_to_harness_config` maps the neutral `SessionConfig` to a harness-shaped
`HarnessAgentTemplate`, `_provisioning` decides which files land in the sandbox before the
session starts, and `create_session`/`prompt`/`stream` are shared plumbing. `adapters/harnesses.py`
supplies three concrete adapters (`PiHarness`, `ClaudeHarness`, `AgentaHarness`) and a lookup
table, `_HARNESSES` (`adapters/harnesses.py:149-153`), keyed by `HarnessType`.

**Per-harness config shape.** Pi takes built-in tool names plus resolved tool specs
(`PiAgentTemplate`, `dtos.py:810-865`); Claude drops built-ins and delivers everything over MCP
(`ClaudeAgentTemplate`, `dtos.py:868-921`); `pi_agenta` (`AgentaHarness`) is Pi with forced
extras layered on top (`adapters/harnesses.py:126-146`, `adapters/agenta_builtins.py`). Each
config class implements `wire_tools`/`wire_prompt`/`wire_mcp`/`wire_skills`/
`wire_sandbox_permission`/`wire_harness_files`/`wire_model_ref`/`wire_resolved_connection`
(`dtos.py:649-807`); `utils/wire.py:138-145` calls these polymorphically to assemble the `/run`
payload. This is a clean, working seam: adding a wire field a harness cares about does not
require an `if harness == ...` at the call site.

**`claude_settings.py` is the Layer-1 translation the runner used to own.** `wire_harness_files`
on `ClaudeAgentTemplate` (`dtos.py:897-921`) lazily calls
`build_claude_settings_files` (`adapters/claude_settings.py:204-262`), which merges four rule
sources — the author's `harness.permissions` slice, sandbox-permission-derived deny rules,
per-MCP-server permissions, and per-resolved-tool permissions (F-046, `_rules_from_tool_specs`,
`claude_settings.py:133-192`) — into one `.claude/settings.json` `harnessFiles` entry, or `[]`
when there is nothing to write. `Pi`/`Agenta` inherit the base `wire_harness_files` that returns
`{}` (`dtos.py:754-764`): they render no files. This confirms the runner review's characterization
(`arch-boundaries.md`, strengths section) that `harnessFiles` is "exactly the right generic
pattern" — verified true from the Python side: the runner's job is to write `{path, content}`
blind, and every byte of Claude's permission logic is decided here.

**`capabilities.py`** is a second, independent per-harness table: which provider families, which
deployment surfaces, which connection modes, and which model-naming scheme
(`provider/id` vs Claude's alias set) each harness supports
(`HARNESS_CONNECTION_CAPABILITIES`, `capabilities.py:145-167`). It is consumed both by the
agent service's server-side fail-loud gate (`services/oss/src/agent/app.py:106,109,125`) and,
per its own docstring, was formerly shipped on `/inspect` (now served from a separate
`harness_catalog_document()` catalog path instead, see finding 6).

**`agenta_builtins.py`** holds `AgentaHarness`'s forced defaults: a preamble appended to
AGENTS.md (`compose_instructions`), a persona appended to `append_system`
(`compose_append_system`), forced built-in tools (`force_tools`, `AGENTA_FORCED_TOOLS = ["read",
"bash"]`), and a forced platform skill (`force_skills`, `AGENTA_FORCED_SKILLS`). All four
compose functions are called from exactly one place, `AgentaHarness._to_harness_config`
(`adapters/harnesses.py:126-146`), so the "forced" invariant currently holds by construction.

**`skills/`** is a small, self-contained subsystem: `models.py` defines the one inline-skill
shape (`SkillTemplate`/`SkillFile`) with a name-pattern validator and a path-traversal guard
enforced on the Pydantic model itself (`_validate_safe_skill_file_path`,
`skills/models.py:21-46`) so every construction path is safe, not just the parsing entrypoint.
`parsing.py` adapts `ValidationError` into a typed `SkillValidationError` and gives a clear,
actionable message when an `@ag.embed`/`@{{` marker survives to here unresolved
(`parsing.py:29-60`). `wire.py` is a two-line pass-through to `SkillTemplate.to_wire()`. No
harness-specific skill-directory naming (`.claude/skills`, a Pi skill root) exists anywhere in
the Python tree — that decision is entirely the runner's, matching the doctrine stated in
`adapters/harnesses.py:15`.

**`platform/workflow.py` and `platform/_schema.py`** are unrelated to harness identity: they
resolve `type:"reference"` workflow tools into callback specs
(`AgentaWorkflowToolResolver.resolve`, `platform/workflow.py:42-111`) and expand Agenta's
`x-ag-type-ref` catalog pointers into concrete JSON Schema before a tool spec reaches any
harness (`expand_type_refs`, `platform/_schema.py:82-128`). Both are harness-neutral; they earn
their place in this lane only because they were bundled into it by the scout, not because they
touch harness-specific logic.

**Doc drift check.** `adapters/claude_settings.py:56-58` cites the runner's `mcp-bridge.ts`/
`relay-mcp-stdio.ts`/`tool-mcp-http.ts` at `services/agent/src/tools/...`. The runner review
(A-19) confirms the real path is `services/runner/src/tools/...` — `services/agent/` is the
stale prefix repo-wide. This comment has the same drift as the rest of the tree; it is accurate
about which files own the constant, just wrong about the directory.

## 3. Strengths — keep this

- **`harnessFiles` is real and it works.** Claude's entire permission-rules translation lives in
  one Python module (`claude_settings.py`) and the runner writes files blind. This is the
  strongest evidence in the whole codebase that "the Python adapter renders harness specifics"
  is achievable, not aspirational.
- **Polymorphic wire assembly.** `HarnessAgentTemplate.wire_*()` methods
  (`dtos.py:713-807`) mean `utils/wire.py` never branches on harness identity. A harness that
  needs a new wire field overrides one method; it does not add a conditional to shared code.
- **The forced-extras design is legible.** `agenta_builtins.py`'s docstring names the two
  distinct layers (persona vs AGENTS.md preamble) and why they are kept apart, matching Pi's own
  split. The forced-tools comment (`agenta_builtins.py:56-61`) proactively documents a real
  cross-file invariant (Pi's builtin-gating flip once any custom tool ships) instead of leaving
  it to be discovered as a bug.
- **F-046's tool-permission-to-Claude-rule mapping is worked through carefully.** The docstring
  in `claude_settings.py:19-32` explains, with the specific gate-ordering reason, why an
  `allow` tool needs an explicit Claude rule and why `client` tools get a rule even though
  they're browser-fulfilled. This is exactly the kind of "comment carries the why" discipline
  the runner review praised.
- **Skill safety is enforced on the model, not just at the edges.** `_validate_safe_skill_file_path`
  runs inside `SkillFile`'s own validator, so `SkillFile(...)` constructed directly, not just
  through `parse_skill_template`, cannot escape the skill directory or clobber `SKILL.md`.
- **The capability table's provider lists are real, not `"*"`.** `capabilities.py` documents and
  tests (`connections/test_capabilities.py:31-37`) that Pi's reach is the eight vault-mapped
  providers, not a wildcard — the fail-loud discipline the runner review wants to see more of
  elsewhere in the system is present here.

## 4. Findings

### F-1 (HIGH, short) — Harness-specific instructions filename is chosen in the shared port, not an adapter

**Where:** `interfaces.py:235-251` (`Harness._provisioning`):

```python
filename = (
    "CLAUDE.md" if self.harness_type is HarnessType.CLAUDE else "AGENTS.md"
)
```

**What and why:** `interfaces.py` is the port layer (`Harness`/`Backend`/`Environment`), not
`adapters/`. Its own module docstring says "the per-harness knowledge lives here [in
`adapters/harnesses.py`]." This one line breaks that: it hardcodes a binary Claude/else branch
in the shared base class every harness adapter inherits, rather than letting each adapter
declare its own instructions filename.

**Concrete failure scenario:** adding a fourth harness whose ACP agent expects its own memory
file (e.g. a hypothetical `codex` harness that reads `CODEX.md`, or a harness that reads no
project-memory file at all) silently gets `AGENTS.md` written into its sandbox, because the
`else` branch is the default for "everything that is not Claude." Nothing fails loud; the file
is just wrong, and the mistake is easy to miss because it lives outside `adapters/`, the one
file a reviewer of "add a harness" would think to check.

**Recommendation:** give `Harness` a `ClassVar[str] = "AGENTS.md"` (e.g.
`instructions_filename`) that `ClaudeHarness` overrides to `"CLAUDE.md"`, and have
`_provisioning` read `self.instructions_filename`. Mechanical, no behavior change, and it moves
the last piece of harness-specific knowledge outside `interfaces.py` into `adapters/harnesses.py`
where the module's own docstring says it belongs.

**Horizon:** short — one-line structural fix, worth doing before the next harness is added.

---

### F-2 (MEDIUM, short) — Claude's permission-mode vocabulary and its `mcp__`-prefix filter live in a shared top-level module, not the Claude adapter

**Where:** `permission_rules.py` (not under `adapters/`) defines `CLAUDE_PERMISSION_MODES =
frozenset({"default", "acceptEdits", "plan", "bypassPermissions"})` — Claude Code's literal
`permissions.defaultMode` vocabulary — and `wire_author_permission_rules`, which drops any
authored rule whose pattern starts with `mcp__` (`permission_rules.py:39-51`, "still rendered
into Claude settings; on the runner wire they would double-count"). `dtos.py:33` imports
`wire_author_permission_rules` into `HarnessAgentTemplate.wire_permissions()`
(`dtos.py:713-719`), the SHARED base method every harness's `wire_tools()` calls
(`PiAgentTemplate.wire_tools`, `dtos.py:849-857`; `ClaudeAgentTemplate.wire_tools`,
`dtos.py:887-895`).

**What and why:** this is the inverse of F-1's problem, in the same family. A Claude-specific
naming convention (the `mcp__` addressing prefix) and a Claude-specific mode vocabulary sit in a
module with no harness scoping in its name or location, and its main function runs for every
harness, including Pi (which has no MCP concept and no `defaultMode`). Functionally harmless
today — Pi never emits `mcp__`-prefixed patterns, and nothing reads the `mode` key
`parse_author_permissions` returns except `claude_settings.py` itself — but it means "harness
knowledge is contained in `adapters/`" is not quite true: this module is one of the two places
(with F-1) where it leaks out.

**Concrete scenario:** if a future harness (or a gateway/callback tool naming scheme) ever
produces an author rule pattern that legitimately starts with `mcp__` for a non-Claude harness,
`wire_author_permission_rules` silently drops it from that harness's wire `permissions.rules`,
because the filter has no harness parameter — it always assumes Claude's addressing convention.

**Recommendation:** move `CLAUDE_PERMISSION_MODES` into `adapters/claude_settings.py` (it is
already re-exported there as `PERMISSION_MODES`, so this is a one-place move, not a new
concept). Keep `wire_author_permission_rules` in the shared module, but make it harness-neutral:
either drop the `mcp__` filter entirely (Claude's settings renderer already receives the same
rules and can filter for its own file) or pass an explicit `exclude_prefix` parameter that
`ClaudeAgentTemplate.wire_permissions()`-if it ever needs to differ from the base-supplies.

**Horizon:** short — small, mechanical, no behavior change for the harnesses that exist today.

---

### F-3 (MEDIUM, short) — Capability checks default to permissive for a harness with no table entry

**Where:** `capabilities.py:202-238` (`harness_allows_provider`, `harness_allows_mode`,
`harness_allows_deployment`) — each returns `True` when `HARNESS_CONNECTION_CAPABILITIES.get(harness)`
is `None`, a deliberate, tested choice
(`connections/test_capabilities.py:57-60`, `test_unknown_harness_is_permissive`). These three
functions are the server-side gate: `services/oss/src/agent/app.py:106,109,125` calls them to
reject a provider/mode/deployment the harness cannot honestly reach, before and after the vault
resolve.

**What and why:** the runner review's strongest praised property is "fail closed for any
unknown remote provider" (`run-plan.ts:275-281`, cited in `arch-boundaries.md` strengths and
finding A-4). This table does the opposite for an unknown *harness*: it treats "no entry" as
"allow everything" — every provider, every connection mode including `self_managed`, every
deployment including `bedrock`/`vertex_ai`. The design intent (documented in the function
docstrings) is "a stale table should not break a newly-added harness," which is reasonable for
*display* concerns, but this same table is also the *security* gate in `app.py`.

**Concrete failure scenario:** a developer adds a new `HarnessType` member and wires
`adapters/harnesses.py` (`_HARNESSES`) and `dtos.py` (a new `XxxAgentTemplate`) to get a harness
running end to end, intending to add its `HARNESS_CONNECTION_CAPABILITIES` entry once the
provider matrix is finalized — a plausible, incremental rollout given how the PR history for Pi
subscription providers reads (`capabilities.py:56-66`, staged in explicitly). Until that entry
lands, the harness reaches every vault provider, `self_managed` mode, and `bedrock`/`vertex_ai`
deployments through the pre/post-resolve checks in `app.py`, with no error and no log line — the
exact "silent drop" pattern the runner review's Theme 5 calls out, except inverted: here it is a
silent *grant*, not a silent drop.

**Recommendation:** flip the default to fail-closed (`return False` for an unlisted harness or
an unlisted provider), and add a completeness test asserting every `HarnessType` member has a
`HARNESS_CONNECTION_CAPABILITIES` entry (`assert set(HarnessType) == {HarnessType(h) for h in
HARNESS_CONNECTION_CAPABILITIES}`), so a partially-wired harness fails a unit test rather than
failing open in production. This does not need to happen at launch — today's three harnesses are
all fully tabled — but it should land before the next harness is added, since that is exactly
the moment the gap becomes live.

**Horizon:** short (cheap, and the natural time to fix a permissive default is before it is ever
exercised) — but not launch-blocking, since no untabled harness exists today.

---

### F-4 (MEDIUM, medium) — Harness identity is four registries, not one profile table

**Where:** `HarnessType` enum + `HARNESS_IDENTITIES` (`dtos.py:43-105`), the per-harness
`XxxAgentTemplate` classes (`dtos.py:810-930`), `_HARNESSES` (`adapters/harnesses.py:149-153`),
and `HARNESS_CONNECTION_CAPABILITIES` (`capabilities.py:145-167`) — plus each backend's own
`supported_harnesses` frozenset (`adapters/local.py:32`, `adapters/sandbox_agent.py:127`).

**What and why:** compared to the runner (34 `isPi` + 35 `isDaytona` scattered conditionals per
runner finding A-4), the Python side is in much better shape: there is no scattered
`if harness == "claude"` branching outside the two leaks in F-1/F-2, and each of these four
registries is itself an explicit, readable dict or class hierarchy — not a boolean smear. But it
is still four separate places that must be kept in sync by hand for a harness to work end to
end, plus a fifth per-backend list of which harnesses that backend can drive. This is the
Python-side confirmation of runner finding A-4 (harness knowledge should live in one table): the
Python code already reached for "table," just four of them instead of one.

**What adding codex/opencode would touch, concretely:** a new `HarnessType` value plus a new
`HarnessIdentity` entry (`dtos.py`); a new `XxxAgentTemplate` subclass of `HarnessAgentTemplate`
shaped for that harness's tool delivery (`dtos.py`); a new `XxxHarness(Harness)` adapter class
plus a `_HARNESSES` entry (`adapters/harnesses.py`); a new `HARNESS_CONNECTION_CAPABILITIES`
entry (`capabilities.py`, see F-3 for what happens if this is missed); the instructions-filename
branch in `interfaces.py` (F-1) if the harness needs its own memory-file convention; a new
settings-file renderer under `adapters/` if the harness needs Claude-settings-style file
translation; and each backend's `supported_harnesses` set wherever the harness should be
drivable. That is six to seven touch points across four files, not the "one adapter" the brief
asks whether this is.

**Recommendation:** consolidate identity + capabilities + config-class + provisioning-filename
into one `HarnessProfile`-shaped record per harness (id, display name, slug, `template_cls`,
`capabilities`, `instructions_filename`), and derive `HARNESS_IDENTITIES`,
`HARNESS_CONNECTION_CAPABILITIES`, and `_HARNESSES` from it, the way `dtos.py`'s own
`HARNESS_IDENTITIES` docstring already aspires to ("the single source the agent_template schema
builds the harness `oneOf` from") but only partially achieves. This pairs naturally with the
runner's own A-4/A-8 `HarnessProfile` work, since the two profiles (Python config shape, TS
delivery mechanics) are two views of the same harness fact.

**Horizon:** medium — this is a structural, incremental refactor (each registry can move into
the profile one at a time), not something that blocks launch with three already-stable harnesses.

---

### F-5 (LOW, short) — `AgentaAgentTemplate`'s forced-tools invariant depends on a single, unenforced construction path

**Where:** `agenta_builtins.py:56-61`'s own comment states the stakes precisely: once any custom
tool ships in `request.tools`, the runner flips Pi's builtin gating from "Pi defaults" to
"granted only," so `read`/`bash` must be explicitly granted or skills become unloadable. That
grant only happens because `AgentaHarness._to_harness_config`
(`adapters/harnesses.py:126-146`) calls `force_tools(...)` before constructing
`AgentaAgentTemplate`. Grepping the tree confirms `AgentaAgentTemplate(...)` is constructed in
exactly one place today.

**What and why:** the invariant is correct now, but it is enforced by "there happens to be only
one call site," not by the type system. `AgentaAgentTemplate` itself does not force
`AGENTA_FORCED_TOOLS`/`AGENTA_FORCED_SKILLS` in a validator; a future test helper, a migration
script, or a second construction path that builds an `AgentaAgentTemplate` directly (bypassing
`AgentaHarness`) would silently produce a pi_agenta run without the forced tools, and skills
would go unloadable exactly as the comment warns, with no error.

**Recommendation:** move the forcing into an `AgentaAgentTemplate` model validator (or a
classmethod constructor) so the invariant holds regardless of the call site, not just at the one
call site that exists today. Low priority since nothing violates it now.

**Horizon:** short if picked up, but purely preventative — no current bug.

---

### F-6 (LOW, short) — Dead code: `harness_capabilities_document()` and `_normalize_tool_specs`

**Where:** `capabilities.py:170-185` (`harness_capabilities_document`) — its own docstring says
"NOT shipped on `/inspect` anymore," and a repo-wide grep confirms it is referenced only from its
own module docstring and from `connections/test_capabilities.py`; the actual `/catalog/harnesses`
endpoint uses the sibling `harness_catalog_document()` (`api/oss/src/resources/workflows/catalog.py:12,255,262`).
Similarly, `adapters/harnesses.py:53-55` (`_normalize_tool_specs`) is a "compatibility helper for
old tests/callers" that is, per grep, called only from its own test
(`test_harness_adapters.py:321-353`).

**What and why:** both are harmless but are exactly the kind of "exported symbol never imported
outside its own test" the wider idioms review is asked to look for; flagging here since they sit
in this lane's files.

**Recommendation:** delete `harness_capabilities_document` (keep `harness_catalog_document`, the
one actually served) and delete `_normalize_tool_specs` and its two tests, or fold the one
assertion worth keeping into `test_harness_adapters.py`'s coverage of `coerce_tool_spec` directly.

**Horizon:** short, cleanup-only.

## 5. Reconciliation with the runner review

**Runner A-4 (harness knowledge should be one table).** Confirmed, on the Python side, as
mostly-good with two real leaks and a table-count problem. The `harnessFiles` mechanism the
runner review calls "exactly the right generic pattern" is verified true here: every byte of
Claude's permission logic is produced in `claude_settings.py`, and the runner (per the runner
review) writes it blind. But the Python side is not the single clean counter-example to A-4 the
runner review implies it might be — see F-1 (`interfaces.py`'s Claude-vs-else filename branch)
and F-2 (`permission_rules.py`'s Claude vocabulary in a shared module), plus F-4 (four registries
instead of one profile table). The story is consistent across both reviews: harness identity
wants to be a first-class value (a `HarnessProfile`) on both sides of the wire, and neither side
has fully gotten there yet, though the Python side is closer.

**No other runner finding (A-1, A-2, A-7, A-9, A-10, F1/F2/F9) names this lane's files
directly**; F-3 (the capabilities fail-open default) is a new finding from this side, not a
reconciliation of an existing runner finding, but it rhymes with the runner's own "fail loud for
unknown providers" discipline (`run-plan.ts:275-281`) closely enough to flag it as the same
principle applied inconsistently across the two languages.

## 6. Top-10 priority list

1. **F-1** Move the Claude/AGENTS.md filename branch out of `interfaces.py` into
   `adapters/harnesses.py` as a per-harness class attribute. Short, one-line structural fix.
2. **F-3** Fail closed (not open) for a harness with no `HARNESS_CONNECTION_CAPABILITIES` entry,
   and add a completeness test. Short, cheap, closes the one real security-relevant gap in this
   lane.
3. **F-2** Move `CLAUDE_PERMISSION_MODES` into `adapters/claude_settings.py`; make
   `wire_author_permission_rules`'s `mcp__` filter explicit rather than baked in for every
   harness. Short.
4. **F-4** Consolidate `HARNESS_IDENTITIES` / `_HARNESSES` / `HARNESS_CONNECTION_CAPABILITIES` /
   the per-harness template classes into one `HarnessProfile` registry. Medium, structural,
   pairs with the runner's own A-4/A-8 work.
5. **F-5** Force `AgentaAgentTemplate`'s forced tools/skills in a model validator, not only at
   the one call site that happens to force them today. Short, preventative.
6. **F-6** Delete `harness_capabilities_document` and `_normalize_tool_specs` (dead code, only
   referenced by their own tests). Short, cleanup.
7. Fix the stale `services/agent/src/tools/...` path references in `claude_settings.py:56-58` as
   part of the runner review's broader doc sweep (A-19); the constant names are right, the
   directory prefix is not.
8. Once F-4 lands, revisit whether `capabilities.py`'s `models` maps (Pi's per-provider catalog,
   Claude's alias set) should live on the same `HarnessProfile` record rather than a parallel
   dict, so a harness's full capability picture is one lookup.
9. Add a direct unit test for `Harness._provisioning`'s filename choice per harness type (today
   it is covered indirectly through adapter tests, not asserted as its own contract).
10. Consider whether `skills/models.py`'s bundled-file safety validator
    (`_validate_safe_skill_file_path`) should be exercised with a property-style fuzz test (odd
    path shapes, symlink-looking segments) given it is the one place untrusted author content
    (skill file paths and content) is validated before reaching the wire.
