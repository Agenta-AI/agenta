# Handoff: Pi in-process runner spike

## Live POC

A proof-of-concept stack with the `inprocess` provider ran on a shared dev host during the spike. Ask the team for its address and login; they are not kept in the repository.

- Sandbox: `daytona` stays the default. `inprocess` shows in the agent settings sandbox picker only when the deployment enables it (`AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`) and the user turns on Settings, Preferences, Feature Flags, "In-process agent runtime" (in `/m` or `/w`; stored in that browser, per user). An agent already saved with `inprocess` keeps it. For production behaviour, list `daytona` first: `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS=daytona,inprocess` and `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER=daytona`.
- Models:
  - **Groq `openai/gpt-oss-120b`** ("GPT OSS 120B"). A real model. The free tier allows 8,000 tokens per minute, and one call costs about 5,700 tokens with the build kit off: one message per minute. Turn "Playground build kit" off in Advanced. With the build kit on, Groq refuses with "The request is too large for this model".
  - **A mock model** (`services/runner/spike/mock-llm.ts` on the spike branch, not in this PR), an OpenAI-compatible server with a self-signed certificate that only the stack's runner trusts. It answers after 300 ms and runs a tool when your message contains a directive such as `[[tool:bash {"command":"uname -n; ls"}]]`. An MCP tool needs its full name, for example `[[tool:mcp__agenta_mock_mcp__echo {"text":"hi"}]]`. It works only with `inprocess`: a Daytona run refuses a credential endpoint on a non-443 port ("Invalid Daytona secret plan"), by design.
- What to try on `/m` (times measured on 2026-09-24):
  1. New agent, Groq, build kit off, send "hello": the answer starts in about 1.6 s.
  2. Switch the model to the mock model and send `[[tool:bash {"command":"echo hi > proof.txt; uname -n"}]]`: the command runs in a Daytona sandbox that starts on this first command (first content 1.65 s, done in about 5.7 s), and `proof.txt` shows in the Files pane.
  3. Set Permissions to "Ask" and send a command: the approval card appears in about 0.4 s, before anything runs. Approve and deny both work.
  4. Send `[[tool:bash {"command":"sleep 60"}]]` and press Stop: the runner cancels in about 40 ms. `/m` then shows no "stopped" mark on the turn (a general `/m` bug); the next message runs normally.
  5. Reload the page during `[[tool:bash {"command":"sleep 20; echo done"}]]`: the turn comes back live and finishes once. Open the same session in a second tab: both follow the turn.
  6. Leave a session for more than 5 minutes, then send `[[tool:bash {"command":"cat proof.txt; ls"}]]`: the sandbox starts again and `proof.txt` is still there.
- Known `/m` bugs seen on the POC, not about `inprocess` (recorded, not fixed): the build kit comes back on in a new session; a model that calls a build-kit tool (`rename_session`) after the build kit is turned off fails the run with a reference instead of a readable reply; Stop leaves no "stopped" mark.
- Deploys: the POC runner ran a copy of the runner source, not the worktree, so editing `services/runner/src` never restarted a live turn. A deploy refused to run while a turn was running.
- Sandboxes: a conversation gets a Daytona command sandbox labelled `spike=pi-inprocess` on its first command (lazy start). It stops when the warm pool parks the session (60 s after the last turn) or after 5 idle minutes; Daytona stops an orphan after its autostop interval and deletes it after its autodelete interval.
- Teardown: stop the stack with `run.sh --down --nuke` and its own env file, remove the mock model container, then delete the leftover sandboxes labelled `spike=pi-inprocess`.

## Progress (kept current by the spike agent)

Last update: 2026-09-24 (night), the final fix batch (Codex round 10 and QA round 9). Details: `findings.md`, "Final fix batch".

Final fix batch: done in code and tests (commits `8c5f0f6876` to `b2c34cda21`), not deployed, not pushed.
- R9-2 fixed: a turn ends only after its conversation file is on the drive (bounded, 15 s). When the save fails or times out, the turn still completes, the mismatch is logged, and the turn is not a resume point, so the next cold turn replays from the API's records.
- R9-1 accepted by name (GOAL.md, "Decisions"): an orphan command of a dead runner can write to the drive until it ends, its lifetime or Daytona's autostop; last writer wins; the same exposure as `daytona`. Guard added: every in-process command is killed in the sandbox at its own timeout (at most the 30-minute tool-call limit) plus 60 s.
- R9-3 fixed (runner and web): `{"Authorization": "Token ..."}` is redacted. QAR9-1 fixed: the tool-specs file is `0600` and goes with the relay folder.
- Codex spot items: stale spike scripts deleted, `DaytonaSandbox.createdAt` removed, the transcript signer lives on its workspace; the handle types left (they need the shared environment typed); the `"daytona"` comparisons are provider selection.
- Tests: runner 3,779 unit and 26 integration, `tsc` clean; `@agenta/chat` 1,230, lint-fix clean; gitleaks clean.
- To deploy from this HEAD: `--rebuild runner` then the POC deploy script; `--rebuild api`; `--rebuild services`; `--rebuild web` (web and web-mobile; web-mobile without the build cache for `posthog-js`). No migration.
- Live re-test after the deploy: a turn with a Composio tool leaves no `*.tool-specs.json` in `/tmp/agenta/relay`; check that a turn's end is not noticeably later (the save now sits before it; not measured yet).

Before that: rebase onto `release/v0.121.2` (GOAL.md item 9, first step). Before that, round 9: Codex round 8 fixes and the simplify pass (GOAL.md items 7 and 8). Details: `findings.md`, "Round 9".

Rebase on release/v0.121.2 (2026-09-24, night): not deployed, not pushed. 134 commits replayed onto `6124696937`; 3 commits stopped on a conflict, 1 file each, all in the web (the records read's priority, the queue poll's cadence, a test import). No semantic conflict. Each is recorded in `evidence/rebase-v01212/CONFLICTS.md`. One follow-up commit moves the two gitleaks fingerprints to the new commit SHA (`3633bfa273`, the rebased code tip; this handoff commit sits on top). The old tip is kept as the local branch `backup/spike-pre-rebase-v01212` (`4a76a95670`).
- What the release changed that the spike depends on: nothing in `services/runner` (mounts, error classification), the throttling middleware, the sessions API, the preferences page, the personal flags or `env.py`. It did change the `/m` chat (PostHog analytics, the session-open fan-out, the dismiss-on-send dock), the queue poll in `useServerSessionInputs` (now 2 s with work, 15 s idle, plus `remotelyBusy`), the records read (the first read is no longer low priority), the build kit permissions (API, SDK, agent settings) and channels (API).
- Tests after the rebase: runner 3,773 unit and 23 integration, `tsc` clean; API ruff clean, sessions and throttling 950, full OSS and EE unit 6,855; SDK 3,191; web lint-fix no change, `tsc` clean (chat, sessions, entities, shared, settings-ui, entity-ui, mobile, oss); chat 1,229, sessions 125, entities 2,374, shared 549, settings-ui 127, entity-ui 1,187, mobile 356, AgentChatSlice 355, Preferences 2; gitleaks clean on `origin/release/v0.121.2..HEAD`.
- Live re-test on the POC after the redeploy: (1) the sandbox picker with the preference off and on (the release reworked the agent settings build kit section next to it); (2) on `/m`, a queued message while a turn runs, and a second browser following the run (the poll now slows to 15 s when idle, and the spike stops it off screen or in a hidden tab); (3) opening a session on `/m` shows the transcript, and a finished turn shows under load (the records read now keeps the release's first-read priority).
- To deploy on the POC: runner, no rebuild for the release (it changed nothing there; the round 9 runner code still needs the POC deploy script as noted below); api, `--rebuild api` (release API code: channels, build kit, agent templates; no new Python dependency; the release adds no migration); services, `--rebuild services` (the SDK's build kit instructions changed); web, `--rebuild web` for web and web-mobile, without the build cache for web-mobile, because `/m` gained a third-party dependency (`posthog-js`).

Round 9: done in code and tests (commits `982bd6104f` to `b504ec1b38`); the runner at `45c8621c8a` is on the POC, the rest is not deployed.
- Codex round 8: both P1s fixed with failing tests first (no change starts while a retired sandbox may still land a write, a readable refusal after 20 s; the turn's view refresh runs inside the first tool call and fails it closed). Every P2 fixed: sanitizer gaps (both copies), local-only transcript on restore, writes through a symlink, method-and-path route drift test, bookkeeping budget = max(plan bucket, configured budget; 60,000 by default). The flag-off codes, the blank line, the cancelled-empty-turn and the two web copy differences are accepted by name in GOAL.md.
- A runner without `inprocess` never loads the in-process code or reads its settings.
- Live QA P0 (QAP-1): every `inprocess` turn failed with EACCES as the non-root runner; both images now bake `/home/sandbox/agenta/mounts`. QAP-3 (raw planning error to the client) fixed; QAP-2 (a `daytona` Stop showing output) unconfirmed: the API answered that Stop `obsolete`.
- Simplify: the owner-lease plane and sweep are gone (runner and API; Daytona's own stop and delete intervals clean up after a dead runner, as for `daytona`); 16 of 22 `AGENTA_RUNNER_INPROCESS_*` variables are constants (6 kept); one typed seam for the in-runner harness; shutdown through the existing `interrupted` input; the shared subscription-login writer is the release's again; one retry layer for interaction create; efficiency and dead-code items. `engines/inprocess/` 5,576 to 5,099 lines; API diff +1,395 to +445.
- Tests: runner 3,773 unit + 23 integration, `tsc` clean; API 6,817, ruff clean; web lint clean, entities 2,343, mobile 336, AgentChatSlice 355, chat 1,213; gitleaks clean.
- POC env: the POC env file now lists `daytona,inprocess` with `daytona` as the default (production-like). To deploy the round: `--rebuild runner` (then the POC deploy script), `--rebuild api`, `--rebuild web`. No migration.

Earlier, the flag-safety round:

Feature flag (GOAL.md item 6): done in code and tests, not deployed (commit `19c49c8507`, web only). A per-user preference "In-process agent runtime" in Settings, Preferences (shared page, so `/m` and `/w`), off by default, stored in the browser like the other personal flags; the sandbox picker offers `inprocess` only when the deployment enables it and the preference is on. An agent already saved with `inprocess` keeps it listed, so nothing rewrites it. No API change. Details and tests: `findings.md`, "Feature flag". To see it: `... --rebuild web` (web and web-mobile).

Flag-safety round: done in code and tests, not deployed (commits `01f69240cc` to `e22b61b5b1`):
- Shared bugs fixed, each with a failing test first: the "413" rule (only an HTTP status; after the credit and quota rules), credential-only redaction (runner and web), a raw provider body keeps its reason (`provider_error` for a 4xx), the web leads with the runner's sentence by error code (not braces). `sandbox_busy` and the lease `pointer` route (with the record's `sandbox_id`) removed.
- Accepted shared changes adjusted: bookkeeping budget 60,000/min (above every plan; a test reads the runner and SDK sources against the 18-route list); control plane 30 s per call, retries for 429/502/503/504 on idempotent calls only (interaction create is idempotent by its token; no transport-error retry); failed turns keep the person's message and drop what the agent did, in the replay and the in-process rollback alike; the pool's teardown wait bounded to 30 s with a sentence.
- Codex round 7 on the 2c code: every P1 and P2 fixed with a test (timed-out write, write via temp file and rename, unflushed command, short read, reads wait for the refresh, stalled download, rollback, failed first mount, `.tools/` on a replacement, transcript restore, refresh exit code), plus its four simplify items.
- Small items: owner-only relay folder deleted at teardown (runner host: `inprocess` and `local`); `Dockerfile.dev` runs as `node` (as `Dockerfile.gh` already did); ChatGPT logins unused for 7 days are swept from the state dir (never one a session holds).
- Composio and MCP: `run_tool` takes the action id; `search_tools` finding nothing is Composio's ranking (probed; not ours); `daytona`'s MCP "secret" is the gateway credential its in-sandbox MCP client needs (not changed).
- Docs: the in-process and bookkeeping-budget variables in the configuration reference; the agent run error codes in the error reference.
- Tests: runner 3,777 unit and 23 integration (+4 of 4 real-store in a container), `tsc` clean; API sessions 890, throttling 26, leases 57 on a throwaway Redis, ruff clean; web agenta-chat 1,212, agenta-sessions 125, agenta-entities 2,341, agenta-shared 543, mobile 338, AgentChatSlice 355; gitleaks clean.
- Release gate: not run. It needs this code deployed and an OpenAI key in the POC project's vault (the command is in findings).

To deploy the flag-safety round on the POC (Mahmoud): rebuild runner, api and web.
1. Runner (its Dockerfile changed, so a snapshot deploy is not enough), from the worktree: `chown -R 1000:1000` the runner-state volume (it is root-owned; the runner now runs as uid 1000), then `bash ./hosting/docker-compose/run.sh --license ee --dev --env-file <the POC env file> --rebuild runner`, then the POC deploy script for the source snapshot.
2. API: `... --rebuild api` (the api image also serves the workers, cron and the mock gateways). No migration.
3. Web: `... --rebuild web` (web and web-mobile).

Earlier, round 7 (2c):

Round 7 (2c) is built, tested and committed, not deployed:
- Every Pi tool runs in the command sandbox on its geesefs mount of the session folder and the agent folder; the runner opens no path the model chose and mounts nothing. The sync, `WorkspaceFs`, the runner file tools, the runner mount and the stale-mount recovery are deleted; `engines/inprocess/` went from 6,591 to 5,482 lines. R6-P0-3 and R6-P0-4 are gone with the sync.
- Pi's conversation file: on the runner's disk and in the session's `pi-sessions` drive prefix, through the object store; the sandbox cannot reach it. Skills: the runner puts its snapshot on the drive; the sandbox sets the executable bits on each boot (`--enable-perms`).
- Turn-start refresh of the drive views for every provider (its own commit). No early sandbox start (the setting is removed).
- Measured first (`evidence/round7/`): remount after a start from stopped about 0.7 s, a root refresh on 1,000 files about 50 ms, a write about 55 ms. On real Daytona with the built code: first tool call 2.6 to 2.7 s cold, read 42 to 49 ms warm, first call after a stop 1.6 to 1.8 s.
- Found: a geesefs 0.43 read of a file that shrank behind the mount never ends (every provider; bounded with `--read-retry-attempts 6` for the `inprocess` sandbox; proposal for the others). `fusermount -u` does not work inside a Daytona sandbox, so a dead mount replaces the sandbox (and `daytona`'s own dead-mount cleanup does nothing, recorded).
- Tests: runner 3,748 unit (none skipped) and 23 integration (4 skipped: the real-store suite, run separately in a container, 4 of 4), `tsc` clean. Details: `findings.md`, "Round 7".
- Deploy steps (runner image unchanged; recreate the container; the `ngrok-mounts` tunnel must run): `findings.md`, round 7, "Deploying to the POC".

Rebase on release/v0.121.0 (2026-09-24): 75 commits replayed; one commit stopped on a conflict (2 files, the queue poll in `useServerSessionInputs`), and one more file broke in meaning only (a call to a capability the release removed). Each is recorded in `evidence/rebase-v0121/CONFLICTS.md`. Two desktop-only spike fixes were ported to `/m` (a sanitized trace error; a failed liveness read keeps polling). The old tip is kept as the local branch `backup/spike-pre-rebase-v0121`. Tests after the rebase: runner 3,781 unit (8 skipped) and 18 integration, `tsc` clean; API sessions unit 929 passed, lease and throttling 60 of 60 on a throwaway Redis, SDK agents 1,794; ruff clean; web agenta-chat 1,210, agenta-sessions 125, agenta-entities 2,341, agenta-shared 543, mobile 337, AgentChatSlice 355, `tsc` clean for oss, mobile and the four packages; gitleaks clean on `origin/release/v0.121.0..HEAD`. The POC was redeployed from the rebased tree and live-tested on `/m` (`evidence/qa-m/REPORT.md`): `/m` works with `inprocess`; the three bugs found are general `/m` bugs.

Round 6 (before the rebase):

Round 6 is done: Codex's round 6 review (`evidence/review-round6/codex-review.md`), every item fixed except the two sync P0s, which are open by instruction. Decisions, the item table, the wording corrected, parity, numbers and compliance are in `findings.md`, "Round 6: what changed". Live probes are in `evidence/round6/`.

Done:
- R6-P0-1: a sweep only touches its own deployment's sandboxes. The deployment is the owner store's own id (new runner-only API route `POST /sessions/control/sandbox-leases/identity`, an id created once in the lease store's Redis), or `AGENTA_RUNNER_INPROCESS_DEPLOYMENT_ID`; every sandbox carries it as `agenta.deployment`.
- R6-P0-2: an undecided command is decided only on the sandbox it was sent to; on a replacement its outcome is unknown and it is not run again.
- R6-P1-1: losing the owner registration (store refusal, or no confirmed renewal within a TTL) stops the running command and copies nothing back.
- R6-P1-2: a running slot goes back only once the sandbox is confirmed stopped or gone; unresolved slots are reconciled, and a cap full of them refuses with a sentence.
- R6-P1-3, P1-4, P1-5: repeatable output reads; a cancelled lock wait is cancelled in flight; quoted credentials redacted, withheld error text coded `internal_error` and never replaced by trace text in the web. An unknown in-process model is `model_unavailable`.
- The sweep reads the whole listing and renews the record it took over while it deletes. Overstated comments fixed, including the web's "one stream per tab" (now a list of what a tab can hold).
- Tests: runner 3,735 unit (8 skipped: 6 need S3 or geesefs, 2 are the open sync reproductions) and 18 integration, `tsc` clean; API lease tests 37 of 37 on a throwaway Redis, sessions unit 893 passed, ruff clean; web agenta-chat 1,265, agenta-sessions 125, AgentChatSlice 355, `tsc` clean; gitleaks clean on `4ccf9570d1..HEAD`.

Open at the end of round 6 (closed by round 7, which deleted the sync):
- R6-P0-3 (an incomplete pull listing clears the pending-pull barrier) and R6-P0-4 (a credential rotation deletes a sandbox holding unapplied results).

Incident: stopping the host runner with `pkill -f "tsx src/server.ts"` also sent SIGTERM to the runner container of another stack on the same host. It restarted healthy within seconds and was idle. Processes are stopped by PID from now on.

Running:
- The POC stack, redeployed 2026-09-24 from the rebased tree: api, workers, cron, services, web, web-mobile (`/m`) and runner on this stack's own images, migrations applied, runner snapshot `ed9a2ee2f1`.
- Host spike processes are stopped. The throwaway Redis used for the API tests is removed.
- Daytona: no sandbox labelled `spike=pi-inprocess` is left (deleted with `spike/daytona-audit.ts --delete-spike` after the `/m` QA). A new POC conversation creates one on its first command.

To deploy (Mahmoud): the POC deploy script. No new dependency and no new required setting.

Next (not done):
- Done (CodeRabbit on PR 7124): the runner-local conversation-file folder is per workspace instance (`<cwd>-pi-sessions/<instance>/`), removed when the registry drops the workspace, and swept at the first in-process run of a runner process.
- Deferred (CodeRabbit on PR 7124): a text verdict ("N denied") in the collapsed tool group summary. The PR changed only the icon (accepted by name); new copy is outside the change. The release shows no failure count in that line either.
- Deferred (final API QA, QF-A2): rerun the `daytona` "Stop after the tool call is visible" check with the Stop timed from the turn's start (the invoke's `on_start` hook or the `tool-input-available` frame). The failing run (`evidence/qa-final-r9/daytona_spot_retry.py`) started its 16 s cancel timer before `paced_invoke` slept up to 95 s for the Groq pacing, so the Stop reached the API before the turn existed. The API answered `execution: idle`, `command.state: obsolete` (the release's `not_running` branch in `api/oss/src/core/sessions/commands/service.py`, correct for that input), and the turn then ran to its end. This branch does not change that cancel path. Not a confirmed bug; `inprocess` passed the same check.
- Round 7 on the POC: deploy (Mahmoud's step, see findings round 7) and the live checks of GOAL.md item 2.
- Deferred (flag-safety round): a scoped `search_tools` that falls back to the pinned catalog when Composio ranks other toolkits first; separating the in-process relay from `local` sessions on the same runner (the owner-only folder cannot).
- `evidence/debug-mercury/verify_refusal.py`: look the OpenRouter connection up instead of the hardcoded slug.
- Proposal: `--read-retry-attempts` for `local` and `daytona` mounts too (the geesefs hang, findings round 7).
- Decide on hard isolation and the custom-secret design (findings, round 5).
- Public codes on the runner-authored sentences of `local` and `daytona`, then hidden unknown text everywhere. Out of scope (Mahmoud, 2026-09-24).
- A conditional save in the files pane (QA5W-4); QA5W-2 and QA5W-3 (shared web).
- Live re-test of rounds 5 and 6 on the POC after deploy, including an approval answered at the 10-minute boundary, and a stalled runner (owner loss) on the product path.
- Remove the API's pointer route once round 5 or later is deployed.
- Agreed with Mahmoud (2026-09-24): give each session its own private relay folder (created with owner-only access, deleted when the session closes) instead of the shared `/tmp/agenta/relay/`. Tool requests and results of one session must not be readable from another session's code. This is the stopgap until the direct in-process tool call (design D4, Codex's P2 suggestion). The direct call (D4) itself is out of scope for this release (Mahmoud, 2026-09-24).
- Agreed with Mahmoud (2026-09-24): run the runner as a normal user, not root, inside its container.
- Agreed with Mahmoud (2026-09-24): delete ChatGPT login files from the `runner-state` volume when they are no longer needed.
- Decided by Mahmoud (2026-09-24): custom secrets (`sandbox.credentials`) do not change. They stay plain environment variables in the sandbox, the same as `daytona`; the two-kind credential design stays on file in findings.md.
- Decided by Mahmoud (2026-09-24): the LLM gateway is out of scope for this work (not ready yet). The `inprocess` option is enabled per user through the preferences UI, under a feature flag, not per organization by an operator.
- Decided by Mahmoud (2026-09-24, afternoon): files design is now **2c**, replacing 2b. Every Pi file tool (read, ls, grep, find, write, edit, bash) runs in the command sandbox, which mounts the drive with geesefs as `daytona` does. The runner opens no model-chosen path and mounts nothing (the conversation file goes to the store directly if feasible). Skills are read through the sandbox `read`; nothing special for skills. Lazy sandbox start on the first tool call. Reason: it removes the runner-side file confinement as the last line of defense against reading the runner's environment (`/proc/self/environ`), and deletes WorkspaceFs, the runner file tools, the runner mount and the cache refresh.
- Agreed with Mahmoud (2026-09-24), the "flag-safety" round, to run after the 2b rework: with the feature flag off, `daytona` and `local` behave exactly as `release/v0.121.0`, except for bug fixes accepted by name. Source: `evidence/change-inventory/INVENTORY.md` (36 shared changes). Work list:
  1. Fix the shared bugs: the "413" error rule matches any 413 in text (`errors.ts`, high); the sanitizer redacts `max_tokens: 4096` and sandbox ids; raw HTTP 400 provider bodies lose the provider's reason (keep it, sanitized); the web treats any trace error with `{` or `}` as a refusal (use the code instead).
  2. Control-plane deadlines and retries (`control-plane-fetch.ts`): keep for every provider, no gate (Mahmoud, 2026-09-24). Raise the deadline on bookkeeping calls to about 30 s, and retry only idempotent calls (reads, heartbeats; interaction create needs an idempotency key).
  3. Accept by name, for all providers: the bookkeeping throttle budget (A1), with the 6,000/min cap derived from the plan or set above the largest plan (36,000), and the 17-route list kept exact; the failed-turn history rule, but drop only the tool results and the error and keep the user's message; the web connection fixes (hidden panes hold no stream, one tab holds the project watch, records watch off while the live stream is open), verified with the 3-tab test on `daytona`.
  4. Keep, bounded: the pool eviction waits for a running teardown, with a bounded wait and a readable error.
  5. Remove the unused `sandbox_busy` error code and the leftover `pointer` route.
  6. Prove it: runner parity tests plus the agent release gate on `daytona` with the flag off, compared with the release branch.
  7. Docs: list the new `AGENTA_RUNNER_INPROCESS_*` and API throttling variables in the self-host configuration reference, and document the error codes for clients.
- Agreed with Mahmoud (2026-09-24), for every provider (`inprocess` and `daytona`), whatever the file design: refresh the geesefs view of the session folder and the agent folder at the start of each turn. An edit from the files pane or an upload goes straight to S3, and a mount's 60 s metadata cache can otherwise show the old version to the agent's first reads and commands of the turn. Measure the refresh cost on a 1,000-file folder, and refresh only what changed if a full refresh is too slow.

Written 2026-09-23 by the Agenta Product Agent for the coding agent that will run this spike on a shared dev host. Read this file first, then the files it points to.

## 1. What you are doing

Mahmoud (founder) wants to know whether Pi can run inside the Agenta runner process, with a Daytona sandbox used only for shell commands. Goals, in order:

1. The agent answers as soon as the user talks to it. No wait for a sandbox.
2. The sandbox runs only when a command needs it. Lower Daytona cost.
3. The architecture gets simpler.

This is an exploratory spike. It does not go to production. The deliverable is knowledge: what works, what breaks, which architecture decisions make it feasible, and the numbers. Code should be reasonably clean but does not need to be complete. Pi only. Claude Code and Codex are out of scope.

## 2. Read in this order

All paths are relative to this folder (`openspec/changes/spike-pi-inprocess-runner/`).

1. `proposal.md`: why, scope, and the decision to borrow Rivet's pattern but not the Rivet actor runtime or agentOS.
2. `design.md`: how the runner works today (with file references), the target shape, starting decisions D1 to D7, explorative directions E1 to E5, and risks.
3. `specs/*/spec.md`: eight short capability specs. These are the expected behaviors. Test against them.
4. `tasks.md`: the step-by-step spike plan. Work through it in order and tick boxes as you go.
5. `research/agentos-evaluation.md`: background research on agentOS and on the Rivet "Pi in-process" claim (0.82 MB per session), including how our subscription login and mounts work today.

External references:
- Rivet's Pi integration, the pattern to copy: https://github.com/rivet-dev/actors/tree/037206e5266c12fda62e7ebe53c7a1a11101d41b/integrations/pi (see `src/runtime.ts` and `src/sandbox.ts`, and `benchmarks/session-memory`).
- agentOS (optional direction E5 only): https://github.com/rivet-dev/agentos
- Pi SDK: npm `@earendil-works/pi-coding-agent`. We pin 0.85.1 (`services/runner/package.json`) with patches in `services/runner/patches`. Rivet uses 0.87.0. Tool definitions with pluggable `operations` exist in 0.85.1 (`dist/core/tools/read.d.ts`).

## 3. Where you work

- Machine: a shared dev host. 20 cores, 62 GB RAM, about 19 GB free when this was written.
- Worktree: a separate worktree, detached at `main` `e502a0126b`. The main checkout is a GitButler workspace. Do not run git write commands there. In this worktree, create a local branch `spike/pi-inprocess-runner` before your first commit.
- Host Node is 18.19, which is too old for the runner and for the OpenSpec CLI. Use one of:
  - the runner's Docker image (`services/runner/docker/`), or
  - a user-level Node 24 (for example `nvm install 24` under your home). Do not change the system Node.
- Other stacks run on this machine and people use them: other teams' stacks. Do not stop, restart or reconfigure them. If you start a stack, use your own `COMPOSE_PROJECT_NAME` (one for the spike) and ports that do not collide.

## 4. Credentials and model

Never print, log, commit or paste a secret value. Read values from the files below into your process environment only. Refer to them by name in notes.

- OpenRouter: `OPENROUTER_API_KEY` in the dev host's EE dev env file.
- Daytona: `AGENTA_RUNNER_DAYTONA_API_KEY`, `AGENTA_RUNNER_DAYTONA_API_URL`, `AGENTA_RUNNER_DAYTONA_TARGET`, `AGENTA_RUNNER_DAYTONA_SNAPSHOT` (plus `DAYTONA_*` duplicates) in the dev host's local EE env file.
- Runner and stack settings (`AGENTA_RUNNER_TOKEN`, `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`, and so on) are in the same file. Copy it to a spike-specific env file and change the project name and ports there. Do not edit the original.

Model for all testing: OpenRouter `deepseek/deepseek-v4-flash` (Agenta id `openrouter/deepseek/deepseek-v4-flash`). It is cheap and already the most-referenced OpenRouter model in our catalog. If it fails at tool calling, fall back to `google/gemini-2.5-flash` and note it. For the 100-session memory test, use a local mock model server like Rivet's benchmark does, not a paid model.

Important for the isolation spec: in the Pi in-process design, provider keys must not sit in the runner's process environment, because Pi falls back to environment variables and every session in the process would see them. For quick experiments you may load the key from env, but the real test (task 5.3) must pass it per session through an in-memory credential store.

## 5. Daytona cost and hygiene

- Every sandbox you create costs money while running. Set a short autostop, label sandboxes with `spike=pi-inprocess`, and delete your own sandboxes at the end.
- Never delete or stop sandboxes you did not create.
- Record sandbox running seconds; they are one of the spike's outputs.

## 6. How to work

- Start small. Before touching the full stack, a standalone script in `services/runner` that creates a Pi SDK session with our model and one custom tool is the fastest way to validate D1, D3 and D5.
- Follow `tasks.md` in order. Steps 0 and 1 first. Each step ends with a short finding, whether it worked or not.
- Prefer measurement over opinion. Every claim in the findings should say whether it was observed or inferred.
- Keep permission logic in one place. Reuse `tools/relay.ts` (`executeRelayedTool`, module-private at line 420, needs exporting), `tools/gateway-policy.ts`, `tools/direct.ts`, `permission-plan.ts`. Do not copy permission rules.
- When a direction is clearly blocked, stop, write why, and move to the next one.

## 7. What to hand back

Write `findings.md` in this folder, and keep `tasks.md` checkboxes current. Findings must include:

1. What works and what does not, per spec capability.
2. The numbers: time to first token, command start latency (cold, stopped, running), sandbox seconds per session, runner memory per session, for `daytona` versus `inprocess`.
3. Answers to E1 to E4 (and E5 if tried), each with a recommendation.
4. Risks found that the design did not list.
5. Proposed architecture decisions for Mahmoud to confirm. Mark them as proposals.

Style for anything Mahmoud reads: lead with the outcome, short sentences, plain words, no em dashes, define terms on first use.

## 8. Rules

- Commit locally to `spike/pi-inprocess-runner`. Do not push, open a pull request, or merge unless Mahmoud asks.
- Do not change the `local` or `daytona` providers' behavior.
- Do not touch other stacks, other worktrees, or the GitButler workspace.
- No secrets in commits, logs, findings or chat.
