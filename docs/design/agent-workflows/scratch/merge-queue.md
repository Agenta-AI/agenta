# Merge Queue

Last updated: 2026-06-28

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
