# CodeRabbit triage — agent-workflows PR stack

Read-only triage of CodeRabbit's findings across the agent-workflows PR stack.
Generated 2026-06-25. No branches, PRs, or comments were modified.

Context: this stack is a pre-production POC. Style, naming, doc-wording, and
back-compat suggestions are intentionally **not** worth acting on. Only genuine
bugs / correctness / security / broken-reference findings are flagged below.

## Recommended fixes (substantive)

Ordered by importance. There are **2** findings worth a code change, both
low-to-moderate priority, plus 1 broken-reference doc fix.

1. **PR 4840** — `sdks/python/agenta/sdk/agents/dtos.py:928` — `_parse_harness_kwargs`
   returns `options or dict(defaults.harness_kwargs)`, so a caller who sends an
   **explicit empty** `harness_kwargs: {}` to *clear* inherited per-harness
   settings silently gets the defaults back instead. *Why it matters:* real
   merge-correctness edge — you cannot remove an inherited prompt/permission
   override. *Caveat:* exotic case for a POC; clearing-via-empty-map is rare.
   Fix is one line (distinguish absent vs empty).

2. **PR 4840** — `web/.../agentRequest.ts:184` (`withAgentRunDefaults`) and
   `web/oss/src/components/AgentChatSlice/assets/transport.ts:75` (`configFor`) —
   both spread the original config (`...config` / `...agConfig`) next to the
   nested `agent`, so a config carrying BOTH a nested `agent` and legacy
   top-level `harness`/`sandbox`/`permission_policy` emits both shapes at once.
   *Why it matters:* the FE then ships the pre-migration wire shape for
   partially-migrated configs. *Caveat:* only triggers if a single resolved
   config holds both shapes; service-side `from_params` is canonical anyway, so
   impact is limited. Worth a small strip-legacy-keys cleanup if these PRs ship.

3. **PR 4833** — `services/agent/src/engines/skills.ts` — comment still references
   the deleted in-process `engines/pi.ts`. *Why it matters:* dead/broken code
   reference left after the legacy-backend removal that this PR performs; cheap
   to fix and on-topic for the PR. (Borderline: comment-only, but it is a real
   stale reference introduced/left by this exact change.)

Everything else CodeRabbit raised is doc-wording, lint, markdownlint, design-doc
internal-consistency, or back-compat polish — skip for a POC.

---

## Per-PR sections

### PR 4821 — [docs] Add agent workflow interface inventory
Status: **reviewed**. 7 inline findings.
- All 7 are doc-wording / internal-doc-consistency on interface-inventory
  markdown (callback arg contract phrasing, baggage field alignment across two
  docs, content-list normalization wording, permission anchor wording, Accept
  header "always vs by default", builtin URI not-yet-bound, `/invoke`
  message-history source ordering). One (`workflow-invoke.md` history ordering)
  is flagged "Major" but it's a doc-vs-doc consistency nit about a contract that
  is still being designed — not a code bug.
- Substantive code findings: **none** (all describe docs; the FE Accept-header
  one is a doc-precision note, not a bug).
- Nitpick count: 7

### PR 4828 — [chore] Remove /load-session endpoint + dead session-store scaffolding
Status: **reviewed**. 2 inline findings.
- Both are optional test-hardening suggestions: list `test_routing.py` in the
  ground-truth doc, and add `assert "load-session" not in _RESERVED_PATHS`.
  Reasonable but not required; the change itself is a deletion and the existing
  tests cover it.
- Substantive code findings: **none**.
- Nitpick count: 2

### PR 4833 — refactor(agent): remove legacy in-process backend, rename harnesses
Status: **reviewed**. 3 inline findings.
- `engines/skills.ts` stale `engines/pi.ts` comment reference — **substantive**
  (broken reference, see fix #3 above).
- Other 2: doc wording (`pi_agenta` "forced opinion" phrasing) + stale
  engine-path in `ports-and-adapters.md` (`engines/sandbox_agent.ts` →
  canonical path). Doc nits.
- Substantive code findings: 1 (stale comment reference).
- Nitpick count: 2

### PR 4829 — feat(agent): versioned harness identity + bind builtin agent URI
Status: **reviewed** (walkthrough + "Review finished"). 0 inline findings.
- CodeRabbit found nothing.
- Substantive code findings: **none**.
- Nitpick count: 0

### PR 4830 — feat(agent): wire models as /run schema source + canonical /inspect
Status: **PENDING** — CodeRabbit hit the org PR review rate limit ("Review limit
reached", out of prepaid credits). No review was produced.
- Substantive code findings: unknown (not reviewed).
- Nitpick count: 0 (no review)

### PR 4831 — feat(agent): enforce sidecar trust + disable sandbox boundaries
Status: **PENDING / SKIPPED** — "Review skipped: auto reviews are disabled on
base/target branches other than the default branch." Base is
`feat/agent-contract-versioning-docs`, so CodeRabbit declined to auto-review and
no manual review landed. No findings.
- Substantive code findings: unknown (not reviewed).
- Nitpick count: 0 (no review)

### PR 4838 — feat(agent): fail loud on missing harness capabilities + assertions
Status: **PENDING** — CodeRabbit hit the rate limit. No review produced.
- Substantive code findings: unknown (not reviewed).
- Nitpick count: 0 (no review)

### PR 4834 — feat(agent): enable HTTP (remote) MCP transport with secret headers
Status: **reviewed**. 1 inline finding, already **resolved** ("✅ Addressed in
commits 5df583a to 3f7af39").
- The single finding was a doc-consistency note ("no new wire field" goal vs the
  plan introducing a `headers` field) on a project context.md — already fixed.
- Substantive code findings: **none** (doc nit, resolved).
- Nitpick count: 1 (resolved)

### PR 4835 — test(agent): guard /inspect x-ag-type-ref markers resolve in catalog
Status: **reviewed**. CodeRabbit: "No actionable comments were generated. 🎉"
- Substantive code findings: **none**.
- Nitpick count: 0

### PR 4837 — [docs] Design EmbedRef tools (tools-as-workflows)
Status: **reviewed**. 4 inline findings — all on design-doc prose.
- "concrete client tool config" wording; markdownlint MD040 unlabeled fence;
  README intro vs still-open status.md decision; research.md runnable-branch
  wording ("keep the reference" vs consume resolved artifact). All are
  internal-consistency / wording on a design doc; nothing executable.
- Substantive code findings: **none** (pure docs).
- Nitpick count: 4

### PR 4840 — refactor(agent): collapse run-selection into AgentConfig, rename harness_kwargs
Status: **reviewed**. 4 inline findings — this PR has the only real code findings.
- `dtos.py:928` `_parse_harness_kwargs` empty-map-can't-clear-defaults —
  **substantive** (fix #1 above).
- `agentRequest.ts:192` + `transport.ts:75` legacy top-level run-selection keys
  not stripped when `agent` is present — **substantive, low priority** (fix #2).
- `agent-configuration.md:212` `permission_policy` ownership wording — doc nit.
- Substantive code findings: 2 (the dtos merge edge + the FE double-shape emit).
- Nitpick count: 2 (1 doc + counting the two FE-files finding as one issue; the
  two FE comments describe the same defect across two files).

### PR 4836 — feat(agent): replace sandbox with optional sidecar uri (allowlist-gated)
Status: **PENDING** — "Review in progress / Currently processing new changes",
and a later "Review triggered". The 2 inline comments present are from an earlier
pass on the design doc `security.md` (SSRF-via-DNS-rebinding open question;
loopback-policy still undecided). These are design-review prompts on an open
security design, not code defects.
- Substantive code findings: **none yet** (no code in the reviewed surface; the
  SSRF/loopback notes are valid design questions to resolve before the sidecar
  routing is implemented, but there's nothing to fix in this PR's code today).
- Nitpick count: 2 (design-doc open-question prompts; review still in progress)

---

## Summary

- Total substantive findings worth a code change: **3** (2 in PR 4840, 1 in PR 4833),
  all low-to-moderate priority for a POC.
- PRs with nothing substantive: 4821, 4828, 4829, 4834, 4835, 4837 (and 4836 so far).
- PRs still PENDING (CodeRabbit not done): **4830** (rate-limited), **4831**
  (skipped, non-default base), **4838** (rate-limited), **4836** (in progress).
  Note: 4830/4838 can be re-run once the credit/rate limit resets; 4831 needs a
  manual `@coderabbitai review` because its base isn't the default branch.
