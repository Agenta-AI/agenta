# Status

Last updated: 2026-07-24 (Milestone 4 code complete; subscription auth GREEN; item C blocks ship)

## Now (Milestone 4 — subscription auth)

- CODE COMPLETE and green. Notes: `reports/m4-implementation-notes.md`. Codex now authenticates
  from the operator's ChatGPT/Codex subscription: `~/.codex` is mounted read-write as `CODEX_HOME`
  (gitignored `hosting/.../docker-compose.dev.codex-sub.local.yml`); a local `runtime_provided`
  codex run requires that mount (run-plan mirrors the Claude `CLAUDE_CONFIG_DIR` branch);
  `CODEX_SQLITE_HOME` is redirected off the home in BOTH modes; managed auth-writing stays
  managed-only so the delete-backstop never touches the mount; the SDK `codex` harness now
  advertises `self_managed`. NO `CODEX_CONFIG` emitted (poison-combo invariant intact). Commit
  `e926a32` (+ the `test_capabilities.py` two-mode fix). Suites: runner 1242, SDK agents 691 +
  capabilities, typecheck + ruff clean.
- LIVE QA GREEN at the wire level: `POST /run` harness=codex credentialMode=runtime_provided (no
  key) → `{"ok":true,"output":"I'm running and ready."}`; container `OPENAI_API_KEY` empty; session
  uses ChatGPT auth; run SQLite lands off-mount; `~/.codex/auth.json` md5 UNCHANGED (no corruption).
  MP4: `reports/m4-subscription-qa.mp4`.
- **BLOCKER (item C, product exposure — needs Mahmoud's ruling):** the mount carries the operator's
  whole `config.toml`; its `[mcp_servers.*]` (and `[plugins.*]`/`[apps.*]`) LEAK into product
  sessions and CANNOT be neutralized via `CODEX_CONFIG` (it deep-merges, additive only). Proof +
  options in `spike/config-leakage-findings.md` (recommended fix: mount only `auth.json`, runner
  owns `config.toml`). No neutralization shipped pending the ruling.
- Subscription + TOOLS run: the MCP-tool path fix landed (slice-D drop `003797ee`, resume-key
  `0c925cb3`); a subscription+tools validation on the product path is the recommended next check
  (deferred to avoid colliding with the concurrent MCP-regression debug work; a runner restart
  picks up the resume-key fix).

## Now (Milestone 3)

- Milestone 3 CODE COMPLETE and green. Notes: `reports/m3-implementation-notes.md`. Six commits
  (local only, not pushed): A default ACP mode `agent-full-access` + per-agent `harnessMode`
  override; B runner-side executable-tool gate at the `agenta-tools` loopback MCP pause seam
  (allow/deny/ask-park, cold-replay resume); C Codex ACP gate classification; D `codex_settings.py`
  Layers 1/2 (Layer 3 tables DROPPED per the D-008 amendment — they crashed codex `session/new`);
  plus the resume-key fix (unwrap codex's MCP `{server,tool,arguments}` envelope). Item E holds by
  construction. Suites: runner 1243, SDK agents 691, typecheck + ruff clean, golden byte-identical.
- LIVE QA GREEN at the wire level (worktree :8180, self-contained `list_connections` tool):
  allow runs without pausing; deny refused cleanly + turn continues; ask parks; warm approve-resume
  executes the tool and preserves the codeword FLAMINGO-42; reject-resume declines; cold-replay
  resume preserves context (the pause tears the session down so every resume cold-creates on the
  owner); agent-mode wire sanity classifies + parks a Codex ACP gate. The runner-KILL cold variant
  is inapplicable to LOCAL sandboxes (single-owner guard, by design; cross-replica cold = Daytona/M5).
- OUTSTANDING: the chrome-devtools MP4 (`m3-approvals-qa.mp4`) is not yet recorded (budget). Wire
  evidence in the notes fully validates behavior; the driver is ready.
- Root-cause correction: the earlier "deployment regression" was WRONG — it was Slice D's
  transport-less `[mcp_servers.*]` tables (the SDK is bind-mounted into the SERVICES container, so
  the M2-runner-rollback control never reverted Slice D). Fixed. Two design items approved by the
  coordinator: cold-replay resume; the typed `harnessMode` wire field.
- Coordination: M4 orchestrator concurrently active on this stack; its runner restarts errored
  in-flight resumes (re-run in stable windows), and a concurrent git op reverted the resume-key fix
  once (now committed).

## Earlier

- Milestone 2 CLOSED. Notes: `reports/m2-implementation-notes.md`. Agenta tools deliver and
  execute on Codex over the internal `agenta-tools` loopback MCP channel (proven live: a
  `discover_tools` call delivered as `mcp.agenta-tools.discover_tools`, relayed server-side,
  tool_call + tool_result traced). Run cost renders non-zero after the real fix (emit
  `gen_ai.response.model` on the Codex LLM span) — the M1 "curated catalog needs pricing"
  diagnosis was WRONG (run cost uses litellm keyed by the span model, not the catalog). Curated
  pricing added anyway (feeds the picker tooltip). Codex MCP dot naming (`mcp.<server>.<tool>`)
  handled on the execution path (`bareToolName`, `serverPermissionFor`). Codex user-MCP capability
  block + picker avatar added. One live tool run pinned as an offline replay test
  (`test_codex_tool_replay`). Suites: SDK agents unit 681, integration cost_free 8, runner 1222.
- OPEN (surfaced, not baked): D-008's approved `agent-full-access` default mode is NOT wired;
  tools work today under the default `agent` mode via runner auto-allow. Wiring it is intertwined
  with M3's runner-side gate + per-agent mode override, so it was kept in M3. Mahmoud to decide
  whether to pull it forward.
- Milestone 1 CLOSED. Report: `reports/m1-report.md`; recording `reports/m1-playground-qa.mp4`.

## Milestone 1 detail (closed)

- Milestone 1 (managed key, text only) implemented by Codex, reviewed by Opus. SDK +
  runner done; SDK agents unit suite 680 green, full runner suite 1218 green.
- Durable-mount blocker RESOLVED via the D-002 P8 amendment: keep `CODEX_HOME=<cwd>/.codex`
  and add `CODEX_SQLITE_HOME` (off-mount local dir) so codex's WAL SQLite state leaves the
  geesefs mount. Live QA on the real durable session path is multi-turn green: turn 1 sets
  codeword FLAMINGO-42, turn 2 (same session) recalls it, both finish=stop, no hang. On
  disk: no `*.sqlite` on the mount; all SQLite in `CODEX_SQLITE_HOME`; `sessions/` rollouts
  and the `.tmp/plugins` git clone on the mount are fine (git's `CreateLinkOp` warnings are
  benign, no wedge). Quality passes done (`/simplify`; desloppify applied manually because
  the worktree skill dirs are empty; final diff review). Details in
  `reports/m1-implementation-notes.md`.

## Earlier

- Milestone 0 done; Checkpoint 1 rulings are in: D-003 on-request, D-004
  danger-full-access, D-005 pin the bridge, D-002 managed half approved
  (`<cwd>/.codex`) with a Daytona-placeholder compatibility requirement, D-002
  subscription direction approved (mount as CODEX_HOME plus `CODEX_CONFIG` env
  channel; symlinks only as fallback).
- All derisk probes P1 through P7 are DONE (`spike/derisk-findings.md`). Outcomes:
  subscription delivery confirmed (mount plus `CODEX_CONFIG`, daemon-eviction makes
  it per-run); Daytona placeholder compatibility confirmed; symlink fallback safe
  but unneeded; P2/P6/P7 forced the D-008 pivot.
- **D-008 approved (Mahmoud, 2026-07-24): Posture 2.** Default mode
  `agent-full-access`; Agenta-tool approvals enforced runner-side at the
  `agenta-tools` pause seam; per-agent mode override for authors. Milestone 3
  rescoped accordingly (see plan.md). Upstream ask filed as a supporting comment on
  codex-acp issue #310 (decoupling approvals from full access).
- Milestone 1 implementation running (managed-key text-only slice); corrected
  mid-flight to not bake the withdrawn D-004 defaults and to observe the
  poison-combo constraint (never `sandbox_mode` inside `CODEX_CONFIG`).

## Environment

- Worktree `.claude/worktrees/codex-harness`, branch `worktree-codex-harness`, base
  main commit `7b971d8c10`.
- Deployment up at http://144.76.237.122:8180 (compose project
  `agenta-ee-dev-codex-harness`, Postgres 5433).
- QA account, project, and API key created through the UI; credentials in the
  worktree `.env` (gitignored) together with the OpenAI experiment key.

## Next

- Milestone 2 finishes (tools + pricing), then Milestone 3 (runner-side tool gate
  per D-008), Milestone 4 (subscription), Milestone 5 (Daytona, docs, release gate,
  PR train).

## Blockers

- None. All rulings in; all probes answered.

## Checkpoint log

- 2026-07-24: plan approved by Mahmoud (worktree + own deployment, Codex gpt5.6-sol
  implements, Opus reviews, desloppify + simplify per milestone, per-milestone
  reports, no implicit decisions). Added the same day: maintain the `add-harness`
  playbook as a living skill, updated every milestone.
- 2026-07-24: Checkpoint 1 presented (D-002, D-003, D-004, D-005). Awaiting rulings.
