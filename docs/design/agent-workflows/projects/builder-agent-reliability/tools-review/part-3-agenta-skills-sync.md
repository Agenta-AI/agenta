# Part 3 — Syncing the internal build kit with the agenta-skills lessons

Date: 2026-07-07. Sources: `Agenta-AI/agenta-skills` main @ `4af2677` (merged PRs #1, #2,
#12, #14; open PRs #11, #13; issues #3–#8), the internal catalog
(`sdks/python/agenta/sdk/agents/platform/op_catalog.py`,
`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`,
`api/oss/src/apis/fastapi/applications/overlay.py`), and the build-kit-tools-cleanup /
builder-agent-reliability design docs.

## Why this review

The external `build-agent` skill (agenta-skills repo) is the same playbook as the internal
`build-an-agent` skill, but it has been hardened by real failures: every merged PR in that
repo fixes a mistake a coding agent actually made against a live deployment. The internal
skill and op catalog predate most of those fixes. A builder agent running inside the
platform today still makes the mistakes the external kit already immunized against — the
observed symptom that triggered this review was an in-platform builder committing the wrong
things in the wrong format via `commit_revision`.

The single biggest structural difference: the external kit documents the **exact payload
shapes** (config schema, commit envelope, trigger inputs) in reference files the agent can
read, while the internal kit hands the model `additionalProperties: true` schemas and prose
that names field paths but never shows the shape. The model-facing tool descriptions are
good; the schemas underneath them are where the knowledge is missing.

## A. Real bugs, not skill text

### A1. Trigger ops never pin a revision (internal reproduction of agenta-skills #6 / PR #12)

External finding: creating a schedule or subscription with only a `workflow_variant`
reference produces a trigger with no bound version. The UI treats it as an error state
("Which version runs?" required and unset, Save disabled). The external scripts now require
a `revision_id` (or the literal `latest`, resolved to the variant HEAD via
`POST /api/workflows/revisions/log`).

Internal state: `create_schedule` and `create_subscription` context-bind **only**
`…references.workflow_variant.id` (`op_catalog.py:989-1003`). There is no
`workflow_revision` reference at all, neither bound nor model-suppliable. Every trigger a
builder agent creates lands unbound — the exact bug.

Fix options, in preference order:

1. **API-side default-to-HEAD**: when a schedule/subscription create carries a
   `workflow_variant` reference but no `workflow_revision`, the triggers service resolves
   the variant HEAD and pins it. This fixes every caller (agent, script, future UI) at once.
2. Add an optional model-visible `workflow_revision.id` field to both ops plus skill
   guidance to pass the id returned by `commit_revision`.
3. Do **not** context-bind `$ctx.workflow.revision.id`: the run context carries the revision
   the run *started* on. The canonical flow is commit-then-schedule, so the run's own
   revision is stale by one at scheduling time — a binding would silently pin the
   pre-commit config.

Either way, the skill needs the companion rule (external `SKILL.md`): **triggers do not
follow a new revision automatically** — after a later `commit_revision`, existing triggers
still point at the old revision and must be re-pointed (or the default-to-HEAD semantics
must be "follow HEAD", which is a product decision to make explicitly).

### A2. Harness/provider mismatch commits silently (agenta-skills #3 / open PR #11)

External finding (reproduced 4× across two coding agents): the model pairs
`harness.kind: "claude"` with a non-Anthropic provider or a raw model id. Create/commit
accept it, the UI's Model & Harness never resolves, the agent never runs. The external fix
validates the pairing client-side before any API call.

Internal state: `commit_revision.delta.set` is a free object; nothing validates the
committed `parameters.agent` against `AgentTemplateSchema`
(`sdks/python/agenta/sdk/utils/types.py:1200`). The strict schema exists and is already
served to the playground editor via the catalog type — it is just never enforced on the
commit path and never shown to the model.

Fix: validate `delta`-resolved `parameters.agent` against the agent-template schema
server-side on commit (and in `test_run`'s in-memory delta), returning a structured error
the model can react to. This converts a whole class of silent misconfigurations into loud,
self-remediable failures. The claude-only-Anthropic pairing rule belongs in that validator,
not in prose. Resolution 2026-07-07: declined at this layer — see implementation status.

### A3. Verify: what happens on a malformed commit today

The external kit carries the warning "malformed `parameters` silently falls back to the
service default agent" (kept alive through PR #2). Confirm whether the internal invoke path
has the same behavior for a *committed* malformed config. If yes, A2 is the fix; until it
lands, the footgun belongs in the skill.

### A4. Already fixed, needs deployment: empty tool schemas on the claude harness

`6383b90ab6` (2026-07-04) fixed `tools/list` advertising an **empty input schema** for
every snake-case platform op (`commit_revision`, `request_connection`) to Claude Code. Any
runner image built before that date still has the bug — the direct cause of
invented-payload commits on the claude harness. Verify the deployed runner includes it.

Related, still open: `ClaudeHarness` applies neither `compose_instructions` (the AGENTA
preamble) nor `force_skills` (`harnesses.py:101-112`) — only `AgentaHarness` does. A
claude-harness platform agent gets no getting-started skill and no preamble unless its
config carries the embeds. Decide whether the forced-extras guarantee should extend to
claude; if the claude harness is a first-class citizen for platform agents, it should.
Resolution 2026-07-07: declined — see implementation status.

## B. Knowledge to port into the internal skill and schemas

Ranked by how directly each addresses an observed failure.

### B1. Ship the config schema where the model can read it (the wrong-format fix)

External: `references/config-schema.md` documents the full `parameters.agent` object — the
four decision fields, the fixed boilerplate to copy exactly, the gateway tool entry, the
skill entry (`name`/`description`/`body`/`files`, path rules), and a "fields that 500 if
misplaced" list (e.g. `slug`/`content` as top-level skill fields).

Internal: nothing equivalent exists at run time. `commit_revision.delta.set` is
`additionalProperties: true`; the skill names `instructions.agents_md`, `tools`, `skills`
and stops. The model must guess the tool-entry discriminator (`type: builtin | gateway |
code | client | reference | platform`), the skill-template field list, and every
`llm`/`harness`/`runner`/`sandbox` field name.

Port it as a **skill reference file**: `SkillTemplate.files` already supports bundled
files, and the runner materializes them next to `SKILL.md`. Add
`references/config-schema.md` to `BUILD_AN_AGENT_SKILL` with the internal shape (source it
from `AgentTemplateSchema` so it cannot drift — ideally generate it). Keep `SKILL.md`
lean and point to the reference, mirroring the external kit's progressive disclosure.

Alternative considered: a read op that returns the `agent-template` catalog type. More
plumbing, and schema-as-JSON is worse to read than curated markdown; the reference file
wins. (Both can coexist later.)

### B2. Document the delta merge semantics on `commit_revision`

External (`update-agent.sh` docs): "the new config deep-merges onto the current one.
**Scalars and lists (tools, skills, mcps) replace wholesale**; a nested object key you
leave out keeps its old value."

Internal description says "deep-merged" and stops. An agent adding one tool naturally
sends `delta.set.parameters.agent.tools = [the new tool]` and wipes the build kit — which
also severs its own platform ops on the next run. Add one sentence to
`_COMMIT_REVISION_DESCRIPTION`: lists replace wholesale, so send the complete list
(current entries plus the change). Also state that the response returns the new revision
id, and what to use it for (A1's trigger pinning).

### B3. Document the `inputs_fields` template language

External: `references/trigger-inputs.md` documents the whole resolution model — a leaf
string starting with `$` is a JSON Path against the fire context, `/` is a JSON Pointer,
anything else passes through literally, **no string interpolation**, unmatched selector →
`null`, omitted template → the whole context object; the fire-context shape
(`event`/`subscription`/`scope`), the synthetic schedule event, and the canonical pattern:
an explicit imperative `messages` entry with the payload as a sibling key.

Internal: the field description is "Template that maps schedule or event context into run
inputs." The footgun line ("trigger inputs must match what the instructions expect, or the
run starts empty") names the failure without giving the syntax to avoid it.

Port `trigger-inputs.md` as a second skill reference file and tighten the
`inputs_fields` field descriptions on both create ops to name the `$`/`/`/literal rules in
one line each.

### B4. Sharpen the discovery rules

Three external rules the internal skill lacks:

- **Per-integration connection state is authoritative, not the headline match.** The
  matched primary can be the wrong integration while reporting ready; the tool you wanted
  can sit in `alternatives` with `needs_auth`. (External: the `CONNECTIONS:` block rule.)
- **Right integration is not enough — check the event description.** "new github issue
  opened" matches `GITHUB_ARTIFACT_CREATED_TRIGGER` on the word "created" with a ready
  connection (agenta-skills #8 / PR #14). The internal discover response carries event
  descriptions (`api/oss/src/core/triggers/dtos.py`); the skill must say: read the matched
  event's description and the alternatives before wiring anything.
- **No plausible match → stop.** Tell the user the integration does not support that
  trigger yet; never wire the closest keyword hit.

### B5. Enumerate the `test_run` verdicts and the read-back rule

The internal skill mentions `pass` and `incomplete`; the contract has four verdicts
(`pass` / `incomplete` / `unconfirmed` / `failed`, per
`build-kit-tools-cleanup/api-design.md`). Two external rules to add:

- **A tool name appearing in the executed list is not proof it completed.** A gated write
  can be dispatched and never deliver — that is `unconfirmed`, the stalled-approval
  signature (external `check-tools.sh` lesson, PR #1).
- **For an external write, the only certain proof is reading the side effect back**
  (fetch the channel history, re-read the issue). Add as the final verification rung.

Enumerate the verdicts in `test_run`'s description too, so the meaning survives even when
the skill is not loaded.

### B6. Instruction-writing rules the internal skill is missing

The internal skill already has the numbered-procedure / pin-ids / end-on-terminal-action
rules. Two more from the external `writing-instructions.md`, both traced to real derails:

- **Prefer narrow, filtered tools over list dumps.** A ~200 KB `LIST_ALL_CHANNELS` payload
  makes the run reach for `python3`/`jq` to sift it, tripping the separate code-execution
  approval gate and derailing the run even when instructions forbid it. Use
  `FIND_CHANNELS` over `LIST_ALL_CHANNELS`, `GET_AN_ISSUE` over `LIST_REPOSITORY_ISSUES`.
- **Write the persona as an explicit imperative.** On ambiguous input the underlying
  harness falls back to a generic coding-assistant persona instead of doing the job; the
  same rule motivates phrasing test messages as commands (already partially present as
  "blunt instruction-framed test message").

### B7. Add a short remediation section to the skill

The external kit's remediation knowledge, adapted to the internal flow: a denied or failed
commit does not undo earlier connections/triggers (present already); a validation error on
commit means fix the delta and re-commit, not start over; after any commit, re-point
triggers (A1); if a run's resolved harness/model differs from what was committed, the
config silently fell back — fix and re-test (external `RESOLVED` rule; internally, read
`test_run.resolved`). The internal skill has footguns but no "when X fails, do Y" list.

### B8. Ask the connection mode instead of assuming (external open PR #11, second half)

The external kit always wrote `connection.mode: "self_managed"` and PR #11 changes it to
ask the user (self-managed key vs Agenta-managed). The internal skill says "everything
else is fixed" — right default, but when the user asks to change model or provider the
model has no documented enum. The config-schema reference file (B1) covers this; the skill
gets one line: model is an alias (`sonnet`/`opus`/`haiku`/`default`), never a raw model id,
and the harness/provider pairing must be valid (A2 makes it enforced).

## C. Reverse sync — fixes the agenta-skills repo needs from us

- `references/annotate-trace.md` claims "a self-reflecting agent cannot call it
  autonomously today; that path does not exist yet." Internally `annotate_trace` has been
  an agent-callable platform op in the default build kit since the cleanup landed. Update
  the external doc (scoped: the *public-API* kit still has no equivalent, but the claim
  as written is now wrong for platform agents).
- The external kit's `RESOLVED` expectation hardcodes `harness=claude model=sonnet
  connection=self_managed`; once PR #11 lands (mode question) that line needs to match the
  chosen mode.

## D. Priorities

| # | Item | Kind | Where |
|---|------|------|-------|
| P0 | A1 trigger revision pinning (default-to-HEAD) | bug | triggers service (+ op schema if option 2) |
| P0 | B1 config-schema reference file in `build-an-agent` | skill | `agenta_builtins.py` (+ generated reference) |
| P0 | B2 merge-semantics sentence on `commit_revision` | tool description | `op_catalog.py` |
| P0 | A4 verify deployed runner ≥ `6383b90ab6` | ops | dev/prod stacks |
| P1 | A2 validate `parameters.agent` on commit + `test_run` delta | bug/feature | workflows commit path |
| P1 | B3 `inputs_fields` reference file + field descriptions | skill + tool | `agenta_builtins.py`, `op_catalog.py` |
| P1 | B4 discovery sharpening (3 rules) | skill | `_BUILD_AN_AGENT_BODY` |
| P1 | B5 verdict enum + read-back rule | skill + tool | `_BUILD_AN_AGENT_BODY`, `test_run` description |
| P2 | B6 narrow-tools + imperative-persona rules | skill | `_BUILD_AN_AGENT_BODY` |
| P2 | B7 remediation section | skill | `_BUILD_AN_AGENT_BODY` |
| P2 | A4b claude-harness forced skills/preamble decision | design | `harnesses.py` |
| P2 | C reverse-sync agenta-skills docs | docs | agenta-skills repo |

Open questions for review:

1. A1 semantics: pin-at-create (re-point after commits) vs follow-HEAD triggers — product
   decision; the external kit chose pin-at-create with an explicit `latest` resolver.
2. B1 source of truth: hand-write the reference markdown (readable, driftable) vs generate
   from `AgentTemplateSchema` (drift-proof, needs a small generator + CI check). Lean
   generate.
3. A2 scope: full schema validation may reject configs the playground currently accepts;
   needs a compatibility pass before turning on strict.
4. Does the skill-body budget (≤50k chars, target ~100-120 lines for SKILL.md) hold once
   B4–B7 land? Reference files keep the body lean; the added rules are ~25 lines total.

## Implementation status (2026-07-07, overnight run)

All P0/P1/P2 items implemented and reviewed; PR numbers added on open:

- A1 → `fix/trigger-revision-default-head`: `TriggersService._validate_references` pins the
  variant HEAD revision when only a variant reference is sent (create + edit, schedules +
  subscriptions); `TriggerReferenceInvalid` now surfaces as 422 on the subscription paths too.
  Verified live: a variant-only schedule create returns a pinned `workflow_revision`.
- A2 → DECLINED (PR #5104 closed unmerged, lane deleted). Mahmoud's call: validation must not
  live in the workflows service — that surface needs a full design pass and CTO sign-off.
  Interim fix at the SDK layer instead: typed input schemas on the platform ops (agent-template
  shape in the tool schema itself, advertised over MCP and Pi) plus skill reference files with
  example requests. A server-side validation design remains a candidate for a future design
  review.
- B2/B3/B5 → `feat/build-kit-op-guidance`: op descriptions now state wholesale list replacement,
  the inputs_fields template rules, the four test_run verdicts, and latest-revision trigger
  binding — each claim verified against the resolver/dispatcher/verdict code.
- B1/B3/B4/B5/B6/B7 → `feat/build-an-agent-references` (stacked on op-guidance): the skill now
  bundles `references/config-schema.md` + `references/trigger-inputs.md` (drift-protected by a
  test deriving field names from `AgentTemplateSchema`), plus the discovery/verification/
  instruction-writing/remediation rules. `parsing.py`'s unresolved-embed scan narrowed to
  structural embeds + `@{{` snippets so documentation may contain the literal `@ag.embed`.
- A4b → DECLINED (PR #5107 closed unmerged, lane deleted). Mahmoud's call: capability delivery
  belongs to the build-kit overlay (config layer); harnesses stay neutral, and pi_agenta's
  harness-level forcing was an experiment, not a pattern to extend. No use case or failure mode
  required forcing extras on claude runs. If getting-started-on-claude ever matters, deliver it
  via the overlay embed, not the harness.
- A4 verified: both local runner images contain `6383b90ab6` (the empty-inputSchema fix).
- C → agenta-skills PR #15 (annotate-trace is agent-callable on-platform).

Open questions resolved during implementation: A1 chose pin-at-create with API-side
default-to-HEAD (the FE has no variant-only creation path — its Triggers page only renders);
B1 chose hand-written reference files drift-protected by schema-derived tests.
