# Status

**State: superseded.** All four pieces below shipped in 0.107.0, and all four are now replaced by
the rework in [addendum-always-active.md](addendum-always-active.md): built-in tools left the agent
config entirely, the runner activates all seven on every Pi run, and the Permissions drawer's three
rule lists are the only lever over them. Read the addendum for what is true now; everything from
"Where the work stands" down is the dated record of the 0.107.0 change.

| Shipped piece | Superseded by |
| --- | --- |
| 1. Ship Pi's built-ins in the default template | The template carries no tool entries; the runner activates all seven |
| 2. Narrow the Claude harness warning | The warning is gone with the `builtin_names` field it read |
| 3. Correct the picker's statements and the built-in row label | The picker is replaced by the permissions editor; built-ins never reach the Tools list |
| 4. Update the documentation that describes the default | Rewritten for the new contract |

**Original state (0.107.0): implemented and in review. All four pieces are committed on the branch
`fix/pi-default-builtins` and open as
[PR #5597](https://github.com/Agenta-AI/agenta/pull/5597).**

Last updated 2026-08-01, after the change went up for review.

## Where the work stands

| Piece | State |
| --- | --- |
| 1. Ship Pi's built-ins in the default template | Implemented |
| 2. Narrow the Claude harness warning | Implemented |
| 3. Correct the picker's three false statements and the built-in row label | Implemented |
| 4. Update the documentation that describes the default | Implemented |

All four landed together as one change, per [plan.md](plan.md#order-and-independence).

## What shipped

**Source.**

- `sdks/python/agenta/sdk/agents/pi_builtins.py` (new): `PI_DEFAULT_ACTIVE_BUILTINS`, a tuple of
  Pi's four default built-in names. A leaf module, deliberately not in `agenta_builtins.py`.
- `sdks/python/agenta/sdk/utils/types.py`: `build_agent_v0_default()` builds its `tools` list from
  that constant as `{"type": "builtin", "name": name}` entries.
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`: the Claude warning fires only when the
  built-in set differs from `PI_DEFAULT_ACTIVE_BUILTINS`, and names the tools.
- `services/runner/src/engines/sandbox_agent/run-plan.ts`: `PI_DEFAULT_ACTIVE_BUILTINS` is now
  exported so the parity test can read it. No runner behavior changed.
- `web/packages/agenta-entity-ui/.../PiSettingsControl.tsx`: all three false "Pi's defaults" claims
  corrected, plus the `"Pi defaults"` placeholder.
- `web/packages/agenta-entity-ui/.../agentTemplate/itemDescriptors.tsx`: a built-in row reads its
  own `name`, falling back to `type` for provider built-ins that carry none.

**Tests.**

- `sdks/python/oss/tests/pytest/unit/agents/golden/pi_default_active_builtins.json` (new): the
  shared cross-language fixture, asserted from Python by
  `unit/agents/test_pi_builtins_parity.py` (new) and from TypeScript by
  `services/runner/tests/unit/pi-default-builtins-parity.test.ts` (new).
- `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py`: the crossing test. It runs the
  real chain from the shipped default to the `/run` body (`build_agent_v0_default` →
  `AgentTemplate.from_params` → `ToolResolver.resolve` → `PiHarness._to_harness_config` →
  `request_to_wire`) and asserts `tools == ["read", "bash", "edit", "write"]`. This is the test
  that would have caught the original bug.
- `services/oss/tests/pytest/unit/agent/test_default_agent_template.py`: new
  `test_published_default_grants_pi_default_builtins`; the authoring-extras test now asserts that
  no `platform` or embed entry is present rather than that the list is empty.
- `sdks/python/oss/tests/pytest/unit/agents/test_harness_adapters.py`: the exact default set is
  silent; a subset, a superset, and a non-default name each warn.
- `api/oss/tests/pytest/unit/resources/test_workflow_catalog.py`: the catalog's schema-default
  hoist materializes the four entries into `parameters.agent.tools`.
- `services/runner/tests/unit/sandbox-agent-run-plan.test.ts`: the exact grant list the platform
  now sends, under `allow` (gating off, the fast path) and under `allow_reads` (gating on).
- `web/packages/agenta-entity-ui/tests/unit/itemDescriptors.test.ts` (new),
  `web/packages/agenta-entities/tests/unit/create-ephemeral-app-from-template.test.ts` (new), and
  a no-duplicate overlay case in `web/packages/agenta-playground/tests/unit/agentRequest.test.ts`.

**Documentation.** `interfaces/public-edge/agent-config-schema.md`,
`interfaces/in-service/harness-adapters.md`, `interfaces/README.md` (both index rows),
`documentation/tools.md`, `documentation/agent-configuration.md`, and the config-shape example in
`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`.

Test results: SDK 2330 passed, services 112 passed, API 1495 passed, runner 1308 passed, and the
three frontend package suites 285 / 213 / 929 passed. Every remaining error in the Python suites is
`AssertionError: AGENTA_API_URL must be set`, the acceptance tests that need a running stack.

## Deferred during implementation

- **The default-config block in `interfaces/public-edge/agent-config-schema.md` is still stale in
  other ways.** Its `tools` line is now correct, but the surrounding object still shows the
  pre-migration flat shape (`agents_md`, `model`, `mcp_servers`, `harness: "pi_core"`) and an older
  model id, while the builder emits the nested shape. [plan.md](plan.md) scoped the edit to the
  `tools` line for exactly this reason. Regenerating that whole block, and the same page's field
  table, from real `build_agent_v0_default()` output is worth its own change. The same flat-versus-
  nested drift runs through `documentation/agent-configuration.md`.
- **The manual verification in [testing.md](testing.md#manual-verification) has not been run.** No
  stack was deployed for this work. Both checks remain open.

## Decisions taken

- **The default agent template ships Pi's four default built-ins** (`read`, `bash`, `edit`,
  `write`), rather than the runner changing what an empty grant list means. Reasoning in
  [design.md](design.md#which-built-ins-and-why-those-four) and
  [design.md](design.md#alternatives-considered).
- **Scope is new agents only.** Agents saved before the fix are not repaired.
- **The playground overlay keeps its `read` and `bash` entries.** They guarantee the build kit's
  skill is loadable regardless of what the author's template says, and the overlay's identity merge
  means they cannot duplicate the default's entries.
- **The Claude harness stays silent only for the exact default set** (settled after the Codex
  review; the first draft filtered name by name, which would have silenced a deliberately authored
  subset). Anything else warns and names the tools.
- **No built-in picker is added to the Tools section in this change.** One already exists in
  Advanced, and deciding which surface is canonical is separate work.
- **The new Python constant is `PI_DEFAULT_ACTIVE_BUILTINS`, and it does not live in
  `agenta_builtins.py`** (settled after the Codex review). That module owns the `pi_agenta`
  harness's forced Agenta opinions; Pi's native active set is not one.

## Verified during planning

- The proposed default value validates against the strict `AgentTemplateSchema` and parses into
  four `BuiltinToolConfig` entries through `AgentTemplate.from_params`. Checked by running the real
  models, not by reading them.
- The shared golden fixtures under `sdks/python/oss/tests/pytest/unit/agents/golden/` are built
  from hand-written templates, not from `build_agent_v0_default()`, so no pinned wire contract
  moves. Re-confirmed in the Codex review, including that no runner, API, or web snapshot embeds
  the builder's output.
- `services/oss/tests/pytest/unit/agent/test_default_agent_template.py:68` and `:74` are the only
  assertions in the repository that break.

## Pre-ship conditions

Both came out of the Codex review and neither existed in the first draft.

1. **Do not ship into a shared deployment that still enables the `local` sandbox.** The shipped
   default is `sandbox: local`, `read` runs without approval under `allow_reads`, and a `local` run
   executes on the runner host with no cwd jail. See
   [design.md](design.md#what-read-can-reach-on-the-local-sandbox).

   **Still open.** This is a deployment decision, not a code change, and nothing in the
   implementation can satisfy it. Whoever deploys must confirm that
   `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` excludes `local` on any shared deployment, remembering
   that unset defaults to `["local"]`.

2. **Fix the release-gate seeds before using the gate as evidence.** Both hand-write
   `"tools": []`, so the gate would report green on the shape this change replaces. See
   [testing.md](testing.md#manual-verification).

   **Satisfied.** `.agents/skills/agent-release-gate/resources/qa_probe.py` and
   `resources/qa_product.py` now seed the four typed built-in entries. `qa_product.py`'s
   `template()` helper keeps its `tools or []` fallback: that is a "the caller named no tools"
   default for per-cell fixtures, and the MCP cell passes `tools=[]` deliberately to isolate MCP
   tools, so changing it would alter what those cells assert.

## Blocking nothing, waiting on nothing

The open questions in [open-questions.md](open-questions.md) did not block the work; the first of
them determines whether follow-up work is needed for the scheduled-run half of
[#5562](https://github.com/Agenta-AI/agenta/issues/5562).

When the issue is closed, say that this fixes newly created agents only. It does not repair agents
already saved, and it does not make an unattended write-capable run complete on its own.

## Codex review

**Round 1 (2026-07-30, gpt-5.6-sol at xhigh, read-only).** Codex read the whole workspace, the
prior [pi-builtin-gating](../pi-builtin-gating/README.md) design, the Python and TypeScript chain,
the tests and goldens, and Pi's own shipped source in `node_modules`. Its verdict was "do not
approve as written": the seam is right, the security analysis and two factual claims are not.

Every finding below was re-verified against the code before being accepted or rejected. Nothing was
taken on Codex's word.

**Nothing changes the recommended approach.** Codex agreed the default template is the right seam
and agreed with the rejection of both alternatives (making `[]` mean Pi's defaults, and making the
SDK omit the field). No finding argues for the rejected route or for a fourth seam. What changed is
that the design now states a security surface it had not stated, admits a cost in the option it
chose, and carries two pre-ship conditions.

### Accepted

1. **The `read` grant is an approval-free host-file read on the default sandbox.** The design
   treated `read` running without approval as benign because it is classified read-only. Verified:
   the default sandbox is `local` (`types.py:1071`), a `local` run spawns the harness on the runner
   host (`provider.ts:148`), which the platform's own code calls "unconfined host bash and not a
   tenant boundary" (`services/oss/src/agent/config.py:60`), Pi's `read` documents "relative or
   absolute" paths and resolves them with `resolvePath(filePath, cwd)` with no jail, and
   `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` defaults to `["local"]` when unset
   (`sandbox_providers.py:30`). One correction to Codex's framing: this change does not create the
   capability. The playground overlay already forces `read` and the playground also runs `local`,
   so it exists interactively today. What the change adds is the unattended, non-playground version
   of it. Folded into design.md as its own section, into open-questions.md as a decision, and into
   the pre-ship conditions above.

2. **Turning the gate off also turns grant enforcement off.** Under a blanket `allow` policy with
   the exact four grants, `computeBuiltinGatingActive` returns false, so the runner never sets
   `AGENTA_AGENT_BUILTIN_GATING` (`pi-assets.ts:369`), the extension's inertness guard skips
   `registerBuiltinGating` (`agenta.ts:373`), and `replaceActiveBuiltinTools` never runs. Verified.
   The four built-ins are then active because Pi activates them, not because the grant list was
   applied. The design sold this as a pure win ("keeps the fast path with no relay round trips");
   it is also the reason a future Pi release that adds a fifth default tool would hand it to an
   agent whose saved grant list names four. Choosing Pi's four is what moves the shipped default
   onto that path. The fix belongs to pi-builtin-gating, not here; the cross-language constant pin
   is the interim guard. Folded into design.md and open-questions.md.

3. **The consumer inventory contained a false claim.** design.md said the built-in's fallback
   parameters at `utils.py:288` have no live caller. Verified false: `retrieve_configuration`
   (`utils.py:526`) is read by `seed_empty_parameters_from_configuration` (`utils.py:534`), which
   the resolver middleware calls on every invoke (`resolver.py:571`, `:596`), and the workflow
   decorator reads the same registry (`decorators/running.py:240`). Two existing tests drive it:
   `test_workflow_shapes_running.py:234` and `test_platform_handlers.py:237`. So the change also
   affects API and SDK callers that invoke a revision bound to `agenta:builtin:agent:v0` with no
   parameters, not only agents created in the playground. Corrected in design.md.

4. **The Claude-golden reason for rejecting the `wire_tools()` alternative was wrong.**
   `ClaudeAgentTemplate.wire_tools()` hardcodes `"tools": []` itself (`dtos.py:921`) and never
   reads `builtin_names`, so editing `PiAgentTemplate.wire_tools()` could not move
   `run_request.claude.json`. Verified. The rejection stands on the authoring-semantics argument
   alone; the false supporting reason is removed from design.md.

5. **Piece 2's warning filter would silence real misconfiguration.** Filtering name by name against
   Pi's defaults means an author who selected only `["bash"]` and then switched to Claude gets no
   warning, because every name in their set is in the default set. The code has no provenance
   field, so the only honest predicate is exact-set equality. Piece 2 and its tests rewritten in
   design.md and plan.md.

6. **A Claude agent created from the default carries four dead Pi entries.** The create-agent
   factory overlays the last-used harness and nothing else (`appUtils.ts:186`,
   `agentCreationPrefs.ts:32`), so a Claude agent minted from the Pi default keeps the four
   built-in rows. Verified. Cosmetic, not blocking; recorded in design.md and filed with the
   surface question in open-questions.md, because the real fix is harness-aware creation.

7. **The test plan stops at the wire and never reaches the product path.** The crossing test proves
   builder-to-wire and would have failed on the original bug, but nothing covers catalog
   materialization, the frontend factory, or the commit. Two cheap additions folded into
   testing.md. Codex also caught that the sketch calls a `resolve_tools_offline` that does not
   exist, and that hand-constructing `PiAgentTemplate` skips `PiHarness._to_harness_config`, which
   removes one of the two properties the test is for. Both corrected.

8. **The release-gate seeds hand-write `tools: []`.** Verified at `qa_probe.py:82` and
   `qa_product.py:752`. The gate named in testing.md as the harness for manual check 2 would have
   reported green on the exact shape this change replaces. Now a pre-ship condition.

9. **The regex-over-TypeScript pin is a maintenance trap.** Replaced in testing.md with a shared
   golden fixture asserted from both languages, the way `permission_decisions.json` already is.
   Also verified that CI runs the Python half on a `services/**` change, so the pin does fire in
   both directions.

10. **The constant's name and home.** Renamed to `PI_DEFAULT_ACTIVE_BUILTINS`, matching the
    TypeScript name exactly, and moved out of `agenta_builtins.py`. That module's own contract says
    it holds "the Agenta harness's forced defaults: the things `AgentaHarness` always applies"
    (`agenta_builtins.py:1`); Pi's native active set is not an Agenta opinion, and putting it
    beside `AGENTA_FORCED_TOOLS` would blur the exact distinction this bug is made of.

11. **Piece 3 has three false strings, not one.** The file header comment (`:5`), the `onChange`
    prop comment (`:25`), and the help text (`:111`) all assert that an absent or empty `tools`
    leaves Pi's defaults. plan.md now names all three.

12. **The pieces are separate review lanes, not separate releases.** Piece 1 alone makes the Claude
    warning fire on nearly every Claude run and shows four misleading rows. plan.md now says they
    ship together, and that piece 1 closes #5590 only for new agents.

### Accepted as observations, not as scope

- **Malformed permission rules fail open.** `normalizeRules` (`permission-plan.ts:191`) silently
  returns `[]` for a non-array, so `{default: "allow", rules: "garbage"}` becomes a blanket allow
  and, with the four grants, turns gating off. Verified. It is real and it is defense in depth: the
  SDK builds `rules` through `wire_author_permission_rules`, so the platform never sends this
  shape. The fix belongs to the permission module, not to a template default. Not folded into the
  plan.
- **Unset versus explicitly empty should stop being the same value.** Verified that
  `default_factory=list` collapses them on both models and that the picker writes `undefined` on a
  deliberate clear. This is the ambiguity that makes repairing existing agents impossible, so it is
  worth fixing, but it is a schema and UI change with its own review. Recorded in
  open-questions.md.
- **The build-kit overlay's tool identity is too broad.** `name:<name>` (`buildKitOverlay.ts:47`)
  would collide a built-in `read` with any other tool type named `read`; `builtin:<name>` would be
  tighter. Verified, and Codex also confirmed the design's own claim that the current `read` and
  `bash` entries replace in place without duplicating. A `web/` change unrelated to this fix.
- **`BuiltinToolConfig`'s comment is stale.** `models.py:87` still says "no runner gate sees them
  on Pi", which the pi-builtin-gating work made untrue. Verified. A one-line comment fix for
  whoever is next in that file.

### Rejected

- **"Add a runtime capability handshake so a stale extension bundle cannot fail open."** The
  failure mode is real and verified (`installPiExtensionLocal` checks that the bundle exists and
  copies, `pi-assets.ts:397`, but nothing attests that it registered the hooks). It is rejected
  *here* because it is not this project's finding: pi-builtin-gating already identified it, already
  called it a silent gate bypass rather than polish, and already filed it as its next slice with a
  design direction (a handshake record written at `before_agent_start`). Duplicating it in this
  workspace would create a second owner for one problem. This change does not make it worse: a
  stale bundle today means Pi's four defaults run ungated, which is the same outcome.
- **"Set an explicit rollout order: deploy gating-capable runners before the Python default starts
  granting tools."** Rejected as stated, because it describes a skew that cannot occur here. Gating
  landed on `main` in commit `3606e5d5cb` on 2026-07-10 and every runner build since carries it;
  the template default and the runner are not independently versioned deployables in this
  repository. Codex's related observation that `/health` exposes only a protocol major and that the
  Python path never probes it is accurate, but a `/run` field whose shape does not change needs no
  negotiation.

## Provenance

Design workspace created 2026-07-30. Research read against the `gitbutler/workspace` branch. Codex
review round 1 folded in above the same day, and the change implemented against that branch the
same day. The work was committed to `fix/pi-default-builtins` and opened as
[PR #5597](https://github.com/Agenta-AI/agenta/pull/5597) on 2026-07-30.
