# Overnight Run — 2026-06-27/28

**Status:** COMPLETE

---

## TL;DR

The agent direct-call-tools feature is fully merged into big-agents. All 8 PRs landed tonight after SDK e2e, playground e2e, two independent security reviews, and a Codex pass. big-agents is green on the short checks.

Two PRs are open for your review (#4873, #4898). A handful of follow-ups are documented below. The most important one to know before you touch anything: the GitButler workspace is messy (merged lanes + a UU conflict marker in tools/router.py). Resync to clean origin/big-agents before starting work.

---

## Merged tonight — 8 PRs into big-agents (2026-06-28)

Merged bottom-up after the playground blockers were found and fixed.

| PR | What it does |
|----|--------------|
| [#4884](https://github.com/Agenta-AI/agenta/pull/4884) | Tool discovery: `POST /tools/discover` + reserved `find_capabilities` tool. Renamed off "docs," description rewritten, 5 real bugs fixed. |
| [#4889](https://github.com/Agenta-AI/agenta/pull/4889) | Phase 1: call descriptor on the resolved spec. |
| [#4891](https://github.com/Agenta-AI/agenta/pull/4891) | Phase 2: sidecar direct-call dispatch, mount-agnostic SSRF guard, `%2e%2e` path-escape closed, `redirect:manual`, generic error messages. |
| [#4892](https://github.com/Agenta-AI/agenta/pull/4892) | Phase 3a: run-context delivery + bind. Interface cleaned per your comments (`session_id` removed, `workflow` regrouped into `artifact`/`variant`/`revision`, `is_draft` inferred server-side, `resolveCtxToken` hardened). |
| [#4893](https://github.com/Agenta-AI/agenta/pull/4893) | Phase 3b: platform-op catalog. `find_capabilities` is now agent-usable. `query_workflows` works. `commit_revision` self-update binds server-side (model-proof). |
| [#4890](https://github.com/Agenta-AI/agenta/pull/4890) | Reference-tool schema expansion: `x-ag-type-ref` expands to concrete, so Claude can construct the call correctly. Source of truth: in-process `CATALOG_TYPES`. |
| [#4896](https://github.com/Agenta-AI/agenta/pull/4896) | Claude: `ENABLE_TOOL_SEARCH=false` so agenta tools receive their full input schema. Fixed the D-4 blocker (tools called with empty args). |
| [#4897](https://github.com/Agenta-AI/agenta/pull/4897) | HITL: restore real tool args on approval so parked tools execute with their input. |

---

## Decisions I made (the ones worth a second look)

**D-1 — Merged the WS-A batch as-is.** The SDK + approval UX are verified. The remaining playground gap is FE-only (no platform-tool picker). Merging is additive and non-breaking. Arda owns the picker.

**D-2 — #4890 source of truth is in-process `CATALOG_TYPES`.** Constraints are catalog-authoritative, not resolved from `/inspect` (which returns the same pointer, not a concrete schema).

**D-3 — #4891: replaced the hardcoded `/api` prefix with a mount-agnostic origin-lock.** This was your comment. It also fixes an OSS-deploy bug. Shallow-merge is deferred; reason is on the PR thread.

**D-4 — #4892 Fork A: trace/telemetry block restructure deferred to its own PR.** The trace block crosses two engine files that drive OTLP export. Folding it into the run-context PR muddies the review and its revert story. The target shape is posted on the #4892 thread.

**D-5 — #4892 Fork B: commit semantics + playground revision-send.** `latest_revision_id` / variant-default belongs in Phase 3b (done). The playground change (send `workflow_revision` when running a committed variant) is Arda's. Arda notified on Slack.

**D-6 — #4896 + #4897 fix the playground blocker; merging did not wait on Arda.** The FE gaps are cosmetic or Arda-owned. The core tool-call flow is correct end-to-end.

---

## Open for your review (do not merge yet)

| PR | State | What to check |
|----|-------|---------------|
| [#4873](https://github.com/Agenta-AI/agenta/pull/4873) | OPEN | Claude + Daytona + gateway tools fix (F-042 in-sandbox relay shim). Rebased onto post-WS-A big-agents, green (tsc + 323 runner tests + bundle 5.4 kB). One gate left: live Claude + Daytona + API-key repro. Held overnight to avoid an unattended Daytona credit/sandbox-leak. Recommend running it together. Top risk: whether `node` is on PATH inside the sandbox. |
| [#4898](https://github.com/Agenta-AI/agenta/pull/4898) | OPEN | `design-interfaces` skill + loop wiring. |

**Also parked (older, not from tonight):**
- [#4880](https://github.com/Agenta-AI/agenta/pull/4880) — all-harness self-hostable agent sidecar
- [#4863](https://github.com/Agenta-AI/agenta/pull/4863) — agent-creation skills + custom-tools design note
- [#4837](https://github.com/Agenta-AI/agenta/pull/4837) — embed design (tools-as-workflows)

---

## QA results

**SDK e2e — PASS.** `find_capabilities`, reference-tool invocation, `query_workflows`, and `commit_revision` self-update all verified under Claude.

**Playground e2e (first pass) — PASS after fixes.** Park, approve, and deny all render correctly. Deny is graceful (not "agent run failed"). Two blockers found and fixed before merge:

- Tools delivered via ToolSearch returned only the name, not the input schema. `commit_revision` called with empty input. Reference workflows returned null. Fixed by #4896 (disable ToolSearch for Claude) and #4897 (restore args on approve). Re-verified clean.

**Second QA (post-merge) — PASS with one finding.**

- Permission ladder (allow/ask/deny) correct on Claude.
- MCP service-gate fails loud (correct).
- MCP http SSRF guards fire (correct).
- F-047 (env-var fix): fixed.
- F-048: logged for the scoreboard.

---

## Follow-ups (documented; not blocking)

**FE/UX gaps (Arda's area):**
- No playground picker to add platform tools (`find_capabilities`, `query_workflows`, `commit_revision`). Must inject via config for now.
- Reference-tool permission requires a raw-JSON edit (`"permission":"allow"`). No dedicated control exists. Tools silently park under Claude without it.
- The reference-workflow picker only loaded about 4 workflows. The fetch is incomplete.
- A reference tool named "Agent" collides with Claude's native Agent/Task tool. Tools need unique names.

**MCP:**
- Confirm the product story. stdio user-MCP is off by design for Claude. http user-MCP is wired but positive end-to-end delivery has not been verified. Both are off by default.

**Agent `/invoke` by reference falls back to the wrong config.** When you call `/invoke` by reference with no inline parameters, the service falls back to the default agent config instead of the committed variant. The default model is `gpt-5.5` with no provider prefix, so it fails silently. Worth a look at `services/oss/src/agent/app.py` and `tracing.py` to trace where the variant-config load is skipped.

**HITL cold-replay fragility.** Resume after a cold replay relies on the LLM re-emitting identical tool args. #4897 narrows the window, but the fragility is pre-existing. Worth a dedicated fix.

**Ops note.** The subscription sidecar is a separate ad-hoc container. `run.sh --build` does not rebuild it. It compiles on startup with no hot-reload. Restart it after any runner or TS change, or flows silently fall back to the legacy `/tools/call` path.

**Local-workspace cleanup.** The live GitButler workspace has merged lanes and a UU conflict marker in `api/oss/src/apis/fastapi/tools/router.py`. Resync to clean `origin/big-agents` before starting work this morning.

**New memory rules added this session:** style-editing for complex comms, verify-the-rename, GitButler-stale-workspace, subscription-sidecar-restart-on-runner-change, CI-hygiene, design-interfaces.
