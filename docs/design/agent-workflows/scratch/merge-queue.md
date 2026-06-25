# Merge Queue

Last updated: 2026-06-25

---

## Merged ✓

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

## Open / parked

| PR | Title | Status |
|----|-------|--------|
| #4836 | Sidecar URI in config | Needs rework: keep sandbox local/daytona, FE builds composite URI |
| #4837 | Embedref: tools as workflows | Design lgtm'd; impl deferred |

Both have been auto-restacked on the new `big-agents` tip.

---

## Endgame

**PR #4791** — `big-agents` → `main` umbrella PR. Once #4836 and #4837 land (or are formally deferred out of scope), this is the final merge.

---

## Known small follow-up

HITL FE: "Approve" button sits disabled ~30–60 s before completing. Front-end park-rendering settle; backend is fine. No PR yet.
