# Merge Queue

Last updated: 2026-06-30

---

## Current state — 2026-06-30

The agent-builds-an-app implementation stack has been merged into `big-agents`. Do not treat the
old queued section below as active merge work.

Merged overnight, bottom-up:

| PR | Branch | Result |
|----|--------|--------|
| #4925 | feat/client-tool-roundtrip-4920 | merged into `big-agents` as `ee2753e53afd7e950e70744cce9e117e7b516f1e` |
| #4929 | feat/build-kit-4917-v2 | merged into `big-agents` as `770cfc76b8d4a67a2665d181b00d3679e461fcc9` |
| #4930 | feat/agent-skills-4918-v2 | merged into `big-agents` as `09a323495c21afaf784c171802db0cdb0b3ffe55` |
| #4931 | feat/agent-builder-tools-4919-v2 | merged into `big-agents` as `959bb8e7499020c9edaf2e8eea947a39b73913cb` |
| #4935 | feat/advanced-collapsible-change1 | merged into `big-agents` as `4901f9970b78c4f235007e3658da84e740222487` |
| #4936 | fix/agent-roundtrip-qa-20260630 | merged into `big-agents` as `74755ebc2a59665740bafec51b8a2ad14b0f0c9a` |

Review focus for Mahmoud:

- Review **#4936** carefully. It contains the overnight runtime/QA hardening for
  `request_connection` and `commit_revision`.
- Confirm that keeping those hardening fixes in a top PR was acceptable. This was chosen to avoid
  risky GitButler lower-lane amendments after the local projection became malformed.
- Decide what to do with `agent-design-docs`. It was not merged with the implementation stack.
- Keep `marketing-website` separate. It is a different lane and should not be mixed into
  agent-workflows cleanup.

QA result:

- `request_connection` browser behavior passed in the local Pi path.
- `commit_revision` browser behavior passed and refreshed the playground to the committed
  revision.
- EE dev stack was rebuilt and `http://144.76.237.122:8280/w` returned `200`.

Residual follow-ups:

- Stream input display still shows `{}` for successful `request_connection` and
  `commit_revision` calls.
- Daytona non-Pi internal gateway-tool advertisement may need a separate matrix check.
- Historical `#4836`, `#4837`, and umbrella `#4791` remain separate endgame items.

---

## Historical queued notes — agent-builds-an-app stack (obsolete after 2026-06-30 merge)

Bottom-up merge order. Merge each only after Mahmoud's review + the conditions below.
Stack is currently `behind` big-agents (advanced upstream); pull/resync before merging.

| PR | Branch | Title | Review | Merge condition |
|----|--------|-------|--------|-----------------|
| #4925 | feat/client-tool-roundtrip-4920 | client-tool round-trip backend (+ static_catalog `type:"client"` fix) | **addressed ✓** (`aa385fafed`); awaiting final LGTM | architecture verdict: tools path is a justified thin adapter over the same `invoke_workflow` service (from #4860, not #4925); comment added. 2 follow-ups pending Mahmoud: (a) optional reference-tool cleanup PR; (b) the regular `commit_workflow_revision` doesn't emit the refresh event — fold into #4925/#4934 (load-bearing for the #4934 commit-refresh QA) + the tool-output-error/denied guard |
| #4929 | feat/build-kit-4917-v2 | build-kit overlay (+ FE overlay-source wiring + `@ag.selector` fixes) | **addressed ✓** (`d07809e7`) | — |
| #4930 | feat/agent-skills-4918-v2 | agent-skills catalog | **LGTM** (minor) | Verify the skill at `agenta_builtins.py:149` is wired across PRs and shows in the playground; confirm in sync at merge (his note) |
| #4931 | feat/agent-builder-tools-4919-v2 | agent-builder tools (op_catalog + find_triggers) | **addressed ✓** (`cc2e131c`) | — |
| #4935 | feat/advanced-collapsible-change1 | collapsible advanced config sections (Change 1) | **LGTM ✓ addressed** (`aaf89486`) | done: collapse-everything-by-default + `aria-expanded` + cancel-toggle restore |
| #4934 | Arda — FE round-trip | request_connection connect flow + commit→refresh | **LGTM ✓**; apply + QA pending | keep 3-min connect timeout; verify commit-emit fires in QA; rebase base onto big-agents at merge; (optional) origin fail-closed after merge |

**Design-doc PRs #4917–#4921: CLOSED ✓** (2026-06-29) as redundant — each implemented by the stack (#4917→#4929, #4918→#4930, #4919→#4931, #4920→#4925+#4934, #4921→full stack); their design markdown lives on the `agent-design-docs` lane.

**`agent-design-docs` lane → merge LAST** (after the implementation stack), once the doc-review pass confirms it is up to date with the as-built implementation + interfaces/data and style-edited.

---

## Merged ✓ — 2026-06-28 batch (trivial fixes)

| PR | Title | Merged |
|----|-------|--------|
| #4899 | Fix: MCP env-var error message text | 2026-06-28 |

---

## Merged ✓ — 2026-06-28 batch (Workstream A: direct-call tools)

Eight approved PRs merged into `big-agents` (merge commits, branches kept). This batch
completes the agent direct-call tools feature.

Parallel fixes (base `big-agents`):

| PR | Title | Merged |
|----|-------|--------|
| #4890 | Expand `x-ag-type-ref` in reference-tool input schemas so harnesses can invoke them | 2026-06-28 |
| #4896 | Claude: disable Tool-Search so agenta tools receive their input schema | 2026-06-28 |
| #4897 | HITL: restore real tool args on approval so parked tools execute with their input | 2026-06-28 |

The stack (bottom→top, each repointed to `big-agents` before merge):

| PR | Title | Merged |
|----|-------|--------|
| #4884 | Tool discovery: `POST /tools/discover` + reserved `find_capabilities` tool | 2026-06-28 |
| #4889 | Direct-call tools Phase 1 — call descriptor on the resolved spec | 2026-06-28 |
| #4891 | Direct-call tools Phase 2 — sidecar dispatch branch | 2026-06-28 |
| #4892 | Direct-call tools Phase 3a — run-context delivery + bind | 2026-06-28 |
| #4893 | Direct-call tools Phase 3b — platform-op catalog + find_capabilities + self-update | 2026-06-28 |

The `_schema.py` add/add between #4890 and #4893 resolved automatically. The content was
byte-identical, so GitHub auto-merged it with no conflict.

FE follow-ups for Arda: the playground has no picker to add platform tools yet; the
reference-tool permission is raw JSON and needs an "allow" control; the reference picker
loads only about 4 workflows; and reference tool names must be unique (one named "Agent"
collides with Claude's native Agent tool).

---

## Merged ✓ — 2026-06-27 batch

Four approved PRs merged into `big-agents` (merge commits, branches kept for the pending resync):

| PR | Title | Merged |
|----|-------|--------|
| #4888 | Fix: Claude honors per-tool `permission:"allow"` (F-046) | 2026-06-27 |
| #4885 | Fix: Composio tunnel idles instead of crash-loop when `COMPOSIO_API_KEY` unset | 2026-06-27 |
| #4860 | Reference-tool backend (`type:"reference"`, env/variant targeting) | 2026-06-27 |
| #4877 | Reference-tool frontend (selector) | 2026-06-27 |

Resync still pending: a `but pull` / local GitButler resync onto the new `big-agents` tip,
which also rebases the stacked lanes #4884 (tool-discovery) and #4889 (direct-call Phase 1).
Branches were intentionally not deleted at merge so those dependents don't break mid-flight.

---

## Merged ✓ (prior)

The entire agent-workflows stack is merged into `big-agents`. Tip: `0c8226acb4`.
This session's work totalled ~18 PRs across two stages.

### Stage 1 (previous session)

| PR | Title |
|----|-------|
| #4821 | Interface inventory + doc fixes — base of the stack |
| #4828 | Remove /load-session + dead SessionStore |
| #4833 | Harness rename (pi_core/pi_agenta) + remove legacy in-process backend |
| #4829 | Versioned harness identity (slug + name) + bind builtin agent URI |
| #4835 | Test: guard /inspect marker-resolution in catalog |
| #4842 | Fix: use generateId() instead of crypto.randomUUID in AgentChatSlice |
| #4830 | Wire models as /run schema source + canonical /inspect response |
| #4839 | Harness-aware provider + model picker — connection rework |
| #4840 | Collapse run-selection into AgentConfig, rename harness_kwargs |

### Stage 2 (this session)

| PR | Title |
|----|-------|
| #4831 | Sidecar trust + sandbox security (disable stdio MCP; network/fs not-implemented errors) |
| #4834 | HTTP MCP transport |
| #4838 | Fail loud: Pi no-response errors loudly, wrong-provider hint fix, startup-banner no longer leaks |
| #4847 | Gateway MCP for Claude |
| #4848 | HITL park + ACP keep-alive + code-tool fail-loud |
| #4844 | Gateway-MCP plan doc |
| #4845 | HITL plan doc |
| #4846 | QA small fixes: clearer bare-model-id error, React-key fix, doc fixes |
| #4849 | Subscription-sidecar doc |

Live sanity passed: playground loads, pickers populate, sandbox enforcement + gateway-tool-for-Claude + HITL Approve/Deny all render.

---

## Ready to merge after e2e (unassigned)

All clear. The direct-call stack (#4884 → #4889 → #4891 → #4892 → #4893) merged in the
2026-06-28 batch above, bottom-up, each rung repointed to `big-agents` before its merge.

---

## Open / parked

| PR | Title | Status |
|----|-------|--------|
| #4836 | Sidecar URI in config | Needs rework: keep sandbox local/daytona, FE builds composite URI |
| #4837 | Embedref: tools as workflows | Design lgtm'd; impl deferred |

#4836 and #4837 have been auto-restacked on the new `big-agents` tip.

---

## Endgame

**PR #4791** — `big-agents` → `main` umbrella PR. Once #4836 and #4837 land (or are formally deferred out of scope), this is the final merge.

---

## Known small follow-up

HITL FE: "Approve" button sits disabled ~30–60 s before completing. Front-end park-rendering settle; backend is fine. No PR yet.
