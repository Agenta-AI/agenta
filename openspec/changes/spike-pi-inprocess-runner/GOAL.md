# Goal: ship the in-process Pi runner behind a feature flag

Agreed with Mahmoud on 2026-09-24 (evening). This file is the contract for the overnight session. Every agent working on this reads it first. Nothing outside it gets built.

## Definition of done

Ready to go to production on the morning of 2026-09-25, meaning all of these are true:

1. **The 2c file design is built.** Every Pi file tool (read, ls, grep, find, write, edit, bash) runs in the command sandbox. The sandbox mounts the session folder and the agent folder with geesefs, as `daytona` does. The runner opens no model-chosen path and mounts nothing. The runner-side sync, `WorkspaceFs`, the runner file tools, the runner mount and the cache refresh are deleted. The sandbox starts lazily on the first tool call. Skills are read through the sandbox `read`; nothing more for skills.
2. **It is deployed on the POC and tested live** (API and `/m`): chat, files, commands, renames and deletes, a files-pane edit seen at the next turn, sandbox stop and restart with remount, Stop, approvals, restart mid-turn, skills, MCP, Composio, 10 sessions at once, a long session.
3. **The old paths are safe.** With the flag off, `daytona` and `local` behave as `release/v0.121.0`, except the shared changes accepted by name (see "Decisions"). Proven by the runner parity tests and the agent release gate run on `daytona` with the flag off, and compared with the release branch.
4. **Sessions work end to end for `inprocess`**, in the API and, where needed, in the web: create, resume warm and cold, resume after a runner restart, approvals (including a long pending one), Stop, errors (readable, with the public codes), transcripts, traces.
5. **Composio and MCP pass** on `inprocess` and `daytona`, and the three issues from `evidence/qa-composio-mcp/REPORT.md` are fixed or recorded as not ours.
6. **The feature flag exists in the UI.** Decision (2026-09-24 evening, by the simplify rule): a browser-side personal flag like the existing ones (`userScopedFlagAtom` in `web/packages/agenta-shared/src/state/featureFlags.ts`), shown on the preferences page; no database column, no migration, no API threading. Correction (2026-09-25, Mahmoud): the preference is the ONLY feature flag, and no deployment setting is needed to turn `inprocess` on. The enabled-list rule: effective enabled providers = the configured `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` list, plus `inprocess` whenever `daytona` is in it (added last, so `daytona` stays the default); a list without `daytona` does not get `inprocess`. Every reader applies it: the runner, the SDK, the API mirror and `web/entrypoint.sh`. It cannot be turned off while `daytona` is enabled (that would need a new variable; see `findings.md`, "The enabled-list rule"). A user who sets `inprocess` through the API without the flag can run it, which is acceptable for a beta of an allowed provider. Reversible later by adding a server-side check. A per-user switch under preferences in `/m` (and `/w` if the same preferences page serves it) enables the option. When it is on, `inprocess` shows as a sandbox choice next to `daytona`. `daytona` stays the default. Off by default for everyone.
7. **Simplified.** One pass over the whole change against the simplify skill (`research/simplify-skill.md`) and the built-in `/simplify` skill: fewer obligations, fewer things to coordinate, dead code gone. Substantial suggestions applied; nits ignored.
8. **Reviewed by Codex** (gpt-6-astra, medium) at least twice more, each time with the specs and the simplify skill in the brief, so it checks against the specs and does not propose new scope. Every P0 and P1 it reproduces is fixed or explicitly accepted with a reason.
9. **The PR is ready.** The clean branch `feat/inprocess-runner` (PR #7124) carries everything, rebased onto the open release `release/v0.121.2` with the PR base moved there (v0.121.1 shipped on 2026-09-24), with an updated description (ASD-STE100) and review comments. CI is green. CodeRabbit comments are answered or fixed, and threads resolved. Note: the heavy CI jobs and CodeRabbit skip draft PRs, so the PR is marked "ready for review" to run them (Mahmoud asked for the CI and CodeRabbit loop); it is never merged. The CLA check for the "Agenta Product Agent" author is Mahmoud's to sign.
10. **Deployed to staging and tested there.** Mahmoud allowed the staging deploy and testing. Run the same live checks as on the POC, plus the release conductor's checks that apply.
11. **Docs and handoff current.** `findings.md`, `HANDOFF.md`, `design.md`, the specs, the self-host configuration reference (new variables), and the error codes for clients. The architecture page (the artifact) reflects the final state.

## Scope rules

- **No new scope.** Only the items above. If something new appears, it goes into `HANDOFF.md` under "Deferred", not into the work.
- **The one exception:** a big security risk that we did not see and did not discuss, with a concrete trigger. Not a re-assessment of known risks. If that happens, fix it, and write plainly in `findings.md` what it was and why it qualified.
- **Every change to a shared path** (`daytona`, `local`, the API, the web) must name the risk it adds to the old path and how it is tested. The flag must stay a real switch.
- **Explicitly not doing:** Pi in its own container; per-session worker processes or worker threads; the LLM gateway; hidden custom secrets (they stay plain variables, as on `daytona`); public error codes for `local` and `daytona`; the direct in-process tool call (D4); early or predictive sandbox start; agentOS; abuse limits.

## Decisions already made (do not reopen)

- Files: 2c (above). Refresh the sandbox mount at the start of each turn, for every provider, so files-pane edits and uploads show up.
- Shared changes accepted by name for all providers: the bookkeeping throttle budget (cap derived from the plan or above the largest plan, route list kept exact); control-plane deadlines and retries (about 30 s, retries only for idempotent calls, interaction create with an idempotency key); the failed-turn history rule (drop the tool results and the error, keep the user's message); the web connection fixes (verified with the 3-tab test on `daytona`); the pool eviction wait (bounded, readable error).
- Also accepted by name for all providers (decided 2026-09-24, round 9; each is a consequence of an accepted fix):
  - The `provider_error` and `sandbox_capacity` codes on `local` and `daytona`: they come with the accepted "keep the provider's reason" and capacity fixes. The exclusion "public error codes for `local` and `daytona`" means no full error-code project for them, not these two codes.
  - The blank line after the turn-context block in the prompt: a bug fix.
  - A cancelled empty turn no longer emits the synthetic no-output error: the accepted QA3A-3 fix.
  - The denied-tool icon and the mobile failure-card copy: the accepted QA1 and label fixes.
  - The SDK's default sandbox provider (QF-A1, final API QA, 2026-09-24): an agent that names no `sandbox.kind` runs on `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER`, else the first enabled provider, else `local`. Before, the SDK always chose `local`, and a deployment without `local` refused such a run with a 403. The release has the same bug, so this is a shared bug fix.
- Accepted by name for `inprocess` (decided 2026-09-24, final fix batch; Codex round 10, R9-1), for parity with `daytona`: when a runner dies while a command runs, the command keeps running in its command sandbox and can write to the drive until it ends, until its lifetime in the sandbox (its own timeout, at most the tool-call limit, 30 minutes by default, plus 60 s), or until Daytona stops the sandbox (autostop, 15 idle minutes by default). A replacement runner works on the same drive from a new sandbox; the last writer wins, with no conflict copy. `daytona` has the same exposure (Pi and its commands live in the sandbox until Daytona's autostop). No lease, and nothing is done about old sandboxes at runner start-up.
- Shared bugs to fix: the "413" error rule; the over-eager sanitizer; the lost HTTP 400 provider reason; the web `{` `}` refusal check. Remove the unused `sandbox_busy` code and the leftover `pointer` route.
- Small items: a private relay folder per session; run the runner as a normal user; delete old ChatGPT login files from the runner volume.
- The POC keeps its storage tunnel, so the command sandbox can reach the POC store.

## Order of work

1. 2c rework (in progress) → deploy to the POC → live test → fix.
2. Flag-safety round (shared bugs, accepted changes, small items, docs) → parity tests and the release gate on `daytona`, flag off.
3. Composio and MCP fixes → retest.
4. Feature flag in preferences (API and web) → live test on `/m`.
5. Simplify pass → Codex review (specs + simplify skill in the brief) → fix → second Codex review if the first found P0/P1.
6. Full live QA on the POC (API and `/m`), including sessions end to end and a long session.
7. Update PR #7124: squash onto the clean branch as before (no IPs, hostnames, local paths or evidence), new description, new review comments. Watch CI, loop until green. Answer and resolve CodeRabbit comments.
8. Deploy to staging (plan: `evidence/staging/PLAN.md`; no configuration change: `inprocess` follows `daytona`), test there, run the applicable release conductor checks.
9. Final: findings, handoff, artifact page, and the morning summary for Mahmoud.

## Rules that always apply

- Work autonomously. No check-ins. Decide, record the decision and why in `findings.md`, and continue.
- One agent edits the worktree at a time. Reviewers and testers are read-only.
- Never push the spike branch; publish only through the clean squashed branch. No secrets, IPs, hostnames or local paths in anything pushed.
- Never `pkill -f` patterns. Never touch other stacks except the tunnel handover already agreed. Delete spike sandboxes; keep at most 10 alive.
- Watch memory and disk; stop load tests under 6 GB free or above 90% disk.
- Writing for Mahmoud: outcome first, short sentences, plain words, ASD-STE100 for the PR, no em dashes.
