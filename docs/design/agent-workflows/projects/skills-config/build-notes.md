# Skills config — build notes (implementation log)

Running log of what was built, what was found live, and the judgment calls made during the
autonomous implementation push. Companion to `proposal.md` (the spec). Newest first.

## Status

- Phase A (SDK `SkillConfig` + `wire_skills()` seam + `ResolverMiddleware` inline-embed fix +
  runner materializer): DONE, reviewed (code-review subagent + Codex xhigh), fix pass applied,
  green.
- Phase B (API `is_skill` family flag + `skill_config` catalog type + `is_locked` lock mechanism
  + project-creation seeding + default-config embed): DONE, green.
- Phase C (FE playground `SkillConfigControl` + Skills section): DONE, lint + typecheck clean.
- Live E2E (local Pi): PASS — the agent genuinely loads and **invokes** the skill (marker token
  observed in a real model reply, negative control clean), for both the inline and the
  embed-reference paths.

## Live E2E results (2026-06-23/24)

Canonical invocation test: skill `weather-oracle`, description "Use this whenever the user asks
about the weather…", body instructs the model to begin its reply with `SKILL-LOADED-7Q42-OK`.
Trigger message "What's the weather like today?". PASS = token present in the reply.

- **Inline skill, local Pi: PASS.** Reply began with `SKILL-LOADED-7Q42-OK`; runner log
  `skills: weather-oracle`. Negative control (no skills) → token absent.
- **Embed reference, local Pi: PASS.** An `is_skill` workflow referenced via
  `@ag.embed{@ag.references{workflow.slug}}` resolved server-side and the reply contained the
  token. Proves the headline reference path end to end.
- **Daytona: BLOCKED (not a skills bug).** Skill *materialized into* the Daytona sandbox
  correctly (`skills: weather-oracle`, `sandbox=daytona`); the run then failed on the
  pre-existing Daytona model-auth gap (provider key not wired into the Daytona ACP daemon), so
  the model never ran. Skills behavior is correct up to that boundary.
- **Claude: BLOCKED on auth; skills correctly dropped.** The runner materializes skills only for
  Pi, so the Claude run dropped them as designed; the run failed at session creation on missing
  `anthropic` provider auth. See gap below.

## Bugs / gaps found live, and decisions

1. **Embed slug 500 (FIXED).** A `workflow_revision` reference with a bare artifact slug and no
   `version` returns HTTP 500 `EmbedNotFoundError`, because a `workflow_revision` slug matches
   the revision's own hash slug, not the author-facing artifact slug
   (`_resolve_revision_with_normalization` only normalizes when a version is present). The
   **seeded default config** used this broken shape, so the default `agenta-getting-started`
   skill itself failed.
   - **Decision:** reference skills at the **artifact** level — `@ag.references{workflow.slug}`
     — which resolves to the latest revision and is verified working. Fixed in
     `services/oss/src/agent/schemas.py` and the proposal docs. Version pinning stays available
     via `{workflow_revision: {slug, version}}`.
   - **Deferred (not done, low risk):** optionally add a no-version bare-slug → latest-revision
     fallback in the shared embed resolver. Not done to avoid blast radius on shared embed
     resolution; the artifact-level reference makes it unnecessary for skills. Logged for a
     future hardening pass.
2. **Claude skills-drop is silent (FIXED).** The proposal calls for the Claude adapter to
   log-and-drop skills (its SDK path can't load SKILL.md). Live, the drop happened but no warning
   was logged. Fixed: the runner now emits a visible warning at the non-Pi drop point
   (`run-plan.ts`), covering any non-Pi harness.

## Decision: defer the lock mechanism to a follow-up PR (2026-06-24)

Two independent final reviews (a code-review subagent + Codex xhigh) converged: the skills core
is sound, but the **`is_locked` lock mechanism is not production-safe** as built. Specific holes:
`is_locked` is settable through public create/edit (any client can permanently brick any
workflow); locked artifacts are still mutable via `create_workflow_variant`,
`fork_workflow_variant` (the DAO fork bypasses the service), and the unarchive paths; and the
seeder's create-then-lock is not idempotent against a partial first seed. Properly hardening this
is a cross-cutting change to the shared workflows service that affects apps and evaluators, and
deserves its own focused PR + review.

**Decision:** remove the lock mechanism from this PR and **seed the default `agenta-getting-started`
skill unlocked**. The skills feature is complete and reviewed-clean without it. Locking the default
skill (so users cannot edit/delete it) becomes a follow-up. Logged as an open issue.

Kept from the reviews (real regardless of the lock):
- Seeding is now **best-effort** — a seeding failure logs and continues, never breaks
  org/project creation/signup.
- The agent-config catalog schema now models a skills entry as **inline OR `@ag.embed`** so the
  seeded default (an embed) validates under raw/advanced schema validation.

## Working preferences captured for this push

- Autonomous mandate: run straight through to PR creation without pausing for approval; make
  best-judgment calls and record them here. Use GitButler for branching/commits; group commits
  sensibly rather than fussing over granularity.
