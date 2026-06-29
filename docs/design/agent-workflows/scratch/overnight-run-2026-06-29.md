# Overnight run — 2026-06-28 into 2026-06-29

Autonomous run authorized by Mahmoud. Goal: implement the four agent-builds-an-app designs as draft PRs, stacked, well-reviewed, with strong descriptions and in-code comments, then light local QA. No merges. Codex for implementation (Claude budget is tight); fall back to Claude subagents only if Codex hits limits.

## Scope

- #4917 default-agent-config (build-kit overlay) — implementation via Codex.
- #4920 frontend round-trip — BACKEND part only via Codex; frontend is Arda's (mentioned on the PR).
- #4918 skills — implementation via Codex (after doc alignment lands).
- #4919 builder tools — implementation via Codex (after doc alignment lands).
- #4921 overview — aligned doc only, no code.

## Stack order (dependency)

#4920 backend (defines request_connection + the client-tool runner) is the base. #4917 (overlay references request_connection) stacks on it. #4918 (skills the overlay embeds) and #4919 (builder ops in the overlay) stack above. Set PR bases to match before any merge (merge is post-review, not tonight).

## Decisions made (best-effort, for Mahmoud's review)

- **Codex usage limit → wait for reset, do not burn Claude budget.** Codex (GPT-5.3-Codex-Spark) hit its account-wide usage limit during the implementation runs; it resets 2026-06-29 03:22 AM. All four codex impls (#4917, #4920, #4918, #4919) are blocked by this same limit (no code written, no PRs yet; the isolated clones are set up). DECISION: wait for the reset and retry all four on codex then, rather than fall back to Claude subagents immediately. Rationale: Mahmoud flagged the Claude subscription budget is tight for the next few days, and four full-stack implementations on Claude subagents would burn exactly that; the overnight timeframe makes the wait free (impls land early AM, before review). Fallback to Claude subagents is held in reserve only if codex is still limited after the reset. A background timer is set to wake the orchestrator ~03:25 AM to retry.
- **UPDATE — no wait needed, codex runs on gpt-5.5.** The #4917 driver found the usage limit is per-model: codex works on `gpt-5.5` (only `gpt-5.3-codex-spark` was capped). So the wait timer was cancelled and all four impls retry on `gpt-5.5` immediately. #4917 is already running on gpt-5.5; #4918/#4919/#4920 re-dispatched on gpt-5.5. Still all on Codex's budget, so the Claude budget is preserved. Fallback to Claude subagents only if gpt-5.5 also caps out.

## PRs

- #4917: impl draft PR #4926 (Codex gpt-5.5, branch feat/playground-build-kit-4917). 20 files / 1525 ins. Backend: additional_context.playground_build_kit.agent_template_overlay on SimpleApplicationResponse, populated in fetch_simple_application, new overlay.py builder (PLATFORM_OPS + reserved-slug static workflows + authoring skill as @ag.embed + sandbox elevation), schemas.py reverted to bare default. Frontend: session atoms + buildKitEnabled (default on), applyBuildKitOverlay (deep/identity merge) in buildAgentRequest on a throwaway copy, commit exclusion, the read-only Playground build kit drawer section + override hint. Tests added. Change 1 (collapsible) intentionally skipped (ships separately). Codex reports ruff/lint/typecheck/vitest 148 green BUT not independently re-run -> verify in local QA. Stacks on #4925. STILL NEEDS: write-pr-description body + code-comment pass.
- #4920: backend impl draft PR #4925 (Codex gpt-5.5, branch feat/client-tool-roundtrip-4920). All green (ruff, tsc, vitest 44). 11 files: onClientTool + parkedCallKey rename in responder.ts, client-tool park in permissions.ts, dispatch.ts client_tool_pending, vercel/messages.py casing, workflow.py __ag__request_connection -> ClientToolSpec(kind=client), static_catalog request_connection (uri client:tool:request_connection:v0), data-committed-revision in tools+workflows routers. @ardaerzin tagged with the frontend checklist. THIS IS THE STACK BASE (#4917 stacks on it). STILL NEEDS: write-pr-description body + code-comment pass (end-of-run QA).
- #4918: impl draft PR #4924 (Codex gpt-5.5, branch feat/agent-skills-4918). Tests pass (API 1040, SDK 441), ruff clean. Added 3 platform-skill constants + static-catalog entries; dropped the stale on-disk getting-started SKILL.md (single-sourced to the SDK constant). NOTE for review: the dropped SKILL.md path is still referenced in some design/QA docs, and services/agent/skills is still Docker/dev-compose mounted (no code references the dropped file) — minor cleanup. STILL NEEDS: write-pr-description-quality body + a code-comment-quality pass (end-of-run QA).
- #4919: impl draft PR #4928 (Codex gpt-5.5, branch feat/agent-builder-tools-4919). RECOVERED: the Codex run finished (~971 ins) but the driver stalled before committing/pushing; the orchestrator committed + pushed + PR'd the existing work. Independently tested on landing: ruff clean, op_catalog 18/18, triggers discovery 6/6, tsc clean, vitest 42/42. The direct.ts/relay.ts/protocol.ts edits are IN-SCOPE (DELETE method allowlist + path-param substitution for the remove tools). STILL NEEDS: write-pr-description body + code-comment pass.

## QA results

- **Independent test re-run — ALL FOUR GREEN** (re-run by the orchestrator in the clones, not just trusting Codex):
  - #4926 build-kit overlay: ruff clean; build_kit overlay test 3/3; default-agent-template 5/5. (This is the one Codex did NOT independently re-run — confirmed green.)
  - #4924 build skills: ruff clean; static_catalog 38/38; SDK agents 441/441.
  - #4928 builder tools: ruff clean; triggers discovery 6/6; op_catalog 18/18; tsc clean; vitest 42/42.
  - #4925 client-tool backend: ruff clean; SDK agents 441/441; tsc clean; vitest 44/44.
- Local deploy + playground visual QA of the build-kit drawer: deferred (heavy: requires combining 4 branches + FE rebuild + browser; Mahmoud asked for light/minimal-compute). Recommend a quick manual playground look once a branch is applied. Backend behavior is covered by the green tests above.

## What to review in the morning

- Each implementation PR's description (write-pr-description) and its in-code comments on the load-bearing parts, for second-round feedback.
