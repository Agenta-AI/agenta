# Lessons log (append-only)

One entry per lesson, newest last, each tagged with the harness project and date.
A lesson is something that surprised us or cost time; the SKILL.md holds the distilled
procedure, this file holds the raw experience that justifies it.

## Codex (2026-07)

- 2026-07-24 · **The daemon already had the runtime.** The old draft PRs looked like
  "a Codex harness implementation" but contained no runtime at all; `sandbox-agent`'s
  embedded registry already installed the CLI and the `codex-acp` bridge. The real
  work was config, credentials, permissions, approvals. Always read the daemon's
  adapter registry first.
- 2026-07-24 · **Measure rebase distance in structure, not commits.** 1,450 commits
  behind sounded fatal; the actual killer was one monolith file having been split
  into eleven modules and a wire-contract rename (`permissionPolicy` to
  `permissions {default, rules}`). The salvage/rewrite/discard table, not the commit
  count, is what made the re-implement decision obvious.
- 2026-07-24 · **We do not map permission vocabularies.** First analysis wrongly
  assumed Agenta permissions must be translated into the harness's. The established
  pattern (from `claude_settings.py`) is pass-through of the author's harness-native
  options plus derived reinforcement rules from Agenta's own layers. Correcting this
  dissolved a fake design decision.
- 2026-07-24 · **Coarse permission vocabularies are the real per-harness risk.**
  Codex has global approval-policy and sandbox modes, no per-tool rules; whether an
  "allow" tool can run without pausing (F-046) becomes an empirical spike question,
  and inexpressible cases go to the decision register.
- 2026-07-24 · **One-directory config is a mount-layout decision.** Codex keeps
  login (`auth.json`, needs read-write for token refresh) and run config
  (`config.toml`, we render it) in the same `~/.codex`; Claude separates them. Never
  decide such a layout silently; table it file by file for Mahmoud.
- 2026-07-24 · **Fresh-worktree deployment gotchas.** Web container restart-loops
  until `chmod -R o+w web/ee/public web/oss/public` (it writes `__env.js` into the
  mounted tree); check the ports another instance already holds before picking
  (8280 was taken, 8180 free); the `.env*` gitignore is allowlist-style, so keys in
  a worktree `.env` are safe from commits and the gitleaks hook.
- 2026-07-24 · **UI-first bootstrap pays for itself.** Signing up the QA account
  through the fresh deployment's UI (instead of the admin endpoint) smoke-tested
  signup on main and surfaced two real observations (a spurious unsaved-changes
  dialog on a pristine new-agent view; the sidebar labels the workspace with the
  organization's name) at zero extra cost.
- 2026-07-24 · **Treat the operator's live login as read-only.** Subscription spikes
  copy `~/.codex/auth.json` into a temp home; token refresh against a copy may not
  stick, and corrupting the operator's real login is never worth the shortcut.
- 2026-07-24 · **Drive the spike through the real daemon, not the CLI.** All four
  spike answers came from `SandboxAgent.start → createSession → prompt` with the
  pinned+patched package from `services/runner/node_modules`. CLI-only probes would
  have missed the two biggest facts: the adapter env channels (`CODEX_CONFIG`,
  `DEFAULT_AUTH_REQUEST`, `CODEX_PATH`) and the exact permission-frame shapes the
  runner must classify.
- 2026-07-24 · **An env-var API key alone may not authenticate a harness.** Codex
  ignored `OPENAI_API_KEY` in the environment until either `auth.json` was
  pre-seeded or the adapter's `DEFAULT_AUTH_REQUEST` auto-login was set. Never
  assume env-key auth; prove the minimal credential setup empirically.
- 2026-07-24 · **Check who installs the bridge and whether it is pinned.** The
  daemon fetched `@agentclientprotocol/codex-acp` with a floating range from a
  registry CDN at first use (the Claude bridge is pinned in package.json). An
  unpinned adapter means gate shapes and config channels can drift under us;
  pinning became decision D-005.
- 2026-07-24 · **Expect nested-sandbox failure inside containers.** Codex's
  bubblewrap sandbox cannot initialize inside our containerized runners, which
  changes approval texture (everything becomes an escalation) and forces the
  sandbox_mode default decision (D-004). Probe the harness's own sandbox INSIDE the
  target environment, not on a bare host.
- 2026-07-24 · **Harnesses read config from the workspace too.** Codex treats
  `<cwd>/.codex/config.toml` and bare `<cwd>/config.toml` as config layers
  (tighten-only). A user repo can silently alter harness behavior; map this early
  for every new harness.
- 2026-07-24 · **A harness that keeps SQLite state in its home directory wedges on an
  S3-backed FUSE mount.** Milestone 1 live QA: managed Codex streamed a text answer on
  an EPHEMERAL cwd, but HUNG on a durable SESSION run. Codex writes SQLite state
  (`goals_*.sqlite` + `-wal`/`-shm`, `logs_*.sqlite`) into `$CODEX_HOME`. With
  `CODEX_HOME = <cwd>/.codex` and `<cwd>` a geesefs (S3) durable session mount, geesefs
  logs `*fuseops.CreateLinkOp error: function not implemented` and the turn never
  completes (SQLite WAL needs hardlinks / shared-memory the mount cannot provide). The
  Milestone 0 spike ran the daemon with `CODEX_HOME` on a plain tmp dir, so it never
  saw this; the durable mount is only exercised in a real session run. Lesson: for any
  new harness, verify its HOME/state directory on the ACTUAL durable-mount filesystem
  (geesefs/Daytona), not a local tmp dir, before approving a mount layout that places
  state on the session cwd. This invalidated the premise of D-002 Option A and is a
  Checkpoint decision, not a code fix to make unilaterally.
- 2026-07-24 · **The harness's own state-dir env override is the fix, not a mount rework.**
  Follow-up to the SQLite-on-geesefs wedge above: codex exposes `CODEX_SQLITE_HOME`
  (upstream `codex-rs/state/src/lib.rs`), which relocates ALL of its SQLite families off
  `CODEX_HOME` while native `session/load` resume rides the plain `sessions/` rollout jsonl
  that stays on the durable home. Keeping `CODEX_HOME` on the durable mount and pointing
  `CODEX_SQLITE_HOME` at a local off-mount dir fixed the M1 durable multi-turn run (codeword
  survived turn to turn, no hang). Lessons for the next harness: (1) before reworking the
  mount layout, look for an upstream env/config knob that moves just the mount-hostile state
  (SQLite/WAL) off the durable filesystem; harnesses that keep append-only rollout files
  separate from their SQLite make this clean. (2) The off-mount state dir must be
  per-session-stable (derive it from `basename(cwd)` like `relayDir`) so it does not churn
  the daemon config fingerprint and kill warm reuse; keep it OUT of fingerprint inputs and
  clean it best-effort on destroy (the SQLite is disposable; resume does not need it).
- 2026-07-24 · **git-on-geesefs is a real but often benign residual risk.** Codex clones a
  plugins repo under `$CODEX_HOME/.tmp/plugins` at session start. On geesefs, git's hardlink
  attempts fail (`CreateLinkOp: function not implemented`), but git degrades gracefully and
  the turn completes. Watch for it when a new harness does VCS/hardlink work on a mounted
  home; confirm it is non-fatal rather than assuming, and note there may be no upstream knob
  to redirect a harness's tmp/scratch dir if it ever turns fatal.

## Milestone 2 (Agenta tools + pricing)

- 2026-07-24 · **Run cost comes from litellm keyed by the SPAN model, not the curated catalog.**
  The platform cost calc (`api .../tracing/utils/trees.py calculate_costs`) calls
  `litellm.cost_per_token(model=...)`, reading the model from `ag.meta.response.model` OR
  `ag.data.parameters.model`. The curated `*_models.curated.json` `pricing` only feeds the model
  PICKER tooltip (FE `connectionUtils.ts`), never the run cost. So "add pricing to the catalog"
  does NOT fix a $0.00 run. A harness shows $0.00 when it records only `gen_ai.request.model`
  (which maps to `ag.meta.request.model`, a field the cost calc does NOT read) and its ACP usage
  carries no cost. Fix: emit `gen_ai.response.model` on the harness LLM span (Pi already does;
  Codex did not). Lesson for the next harness: DIAGNOSE cost by querying the actual span
  attributes (`ag.meta.response.model`, `ag.metrics.tokens/costs`) via `POST /tracing/spans/query`,
  never by trusting a catalog-shaped hypothesis. litellm often already knows a new model id, so a
  $0.00 is almost always a wrong/absent recorded model string, not missing pricing. Scope the
  `gen_ai.response.model` stamp to the harness that needs it (litellm may know another harness's
  model too and would silently recompute its cost).
- 2026-07-24 · **MCP tool names differ per harness: Claude `mcp__<server>__<tool>`, Codex
  `mcp.<server>.<tool>` (dots).** Any name-matching on the EXECUTION path must handle both, or the
  spec lookup misses: `bareToolName` (`client-tools.ts`, used for client-tool correlation AND the
  ACP gate's spec resolution) and `serverPermissionFor` (`acp-interactions.ts`). Symptom of a miss:
  the runner logs `[HITL] ... executor="harness"` with the full dotted anchor instead of
  `executor="relay" specName="<bare>"`, and the tool's real permission is not read (it falls to
  the plan default). Tool EXECUTION still works (the loopback MCP runs the call independent of the
  gate), so this is invisible until you check the gate classification or exercise M3 gating.
- 2026-07-24 · **Agenta tools reach a non-Pi harness with NO per-harness runner change.** Delivery
  is capability-gated: the runner stands up the internal `agenta-tools` loopback MCP server
  (`buildToolMcpServers`) whenever the daemon-probed capabilities carry `mcpTools`. The Codex
  daemon reports the full capability set (mcpTools/toolCalls/…), so callback/platform tools deliver
  and execute (server-side relay) exactly like Claude. The only Codex-specific work is the dot
  naming and the cost stamp above.
- 2026-07-24 · **Default `agent` ACP mode auto-allows, so tools work before D-008's full-access
  default is wired.** Under codex-acp's default `agent` mode, an MCP tool call raises an ACP gate;
  the runner resolves it against the tool's permission (or the plan default) and auto-allows an
  `allow` tool, so the call executes. This means M2 tool execution does NOT require wiring
  `agent-full-access`; that (D-008's approved default, so no gate fires at all, and robustness when
  the runner permission default is `ask`/`deny`) is intertwined with M3's runner-side gate +
  per-agent mode override and was kept there. If you pull it forward, set the session mode via the
  proven `session.setConfigOption("mode","agent-full-access")` (spike e-round) or `session.setMode`.
- 2026-07-24 · **Capturing a replay fixture off the streaming service path: merge the events in.**
  The SDK stream's terminal `{kind:"result"}` record carries `events: []` — the tool_call /
  tool_result / message events arrive as separate `{kind:"event"}` records and are folded live, not
  batched into the terminal result. To capture a fixture the replay `result_from_wire` can parse
  with populated `result.events`, accumulate the streamed events and write them into the recorded
  result's `events` array (the one-shot `_deliver_result` shape). Redact `sessionId` / `traceId` /
  tool-call ids; a result payload holds no secrets. Assert STRUCTURE (tool name, channel, capability
  flags, stop reason), never the tool backend's success (ours recorded `isError` because the QA
  deployment had no Composio provider) or prose.

## Milestone 3 — permissions and human-in-the-loop

- 2026-07-24 · **The runner-side tool gate at the loopback MCP seam resumes by COLD REPLAY, not
  keep-alive.** The `tools/call` on the internal `agenta-tools` HTTP MCP server is a synchronous
  request tied to the turn; when an `ask` tool parks, the socket is aborted (the `MCP_PAUSED`
  sentinel) and the turn ends, exactly like the existing client-tool pause. There is NO ACP
  permission id at this seam, so the Claude/Pi keep-alive `respondPermission` path does not apply.
  Build the gate by mirroring `buildClientToolRelay`: `responder.onPermission` → allow executes,
  deny returns an MCP tool error, ask emits a `user_approval` interaction + `onPause` + `MCP_PAUSED`.
  On the follow-up turn the model re-issues the call and `ConversationDecisions` (built from the
  `{approved}` envelope in history) consumes the decision. Reuse the existing machinery; do not
  invent keep-alive here. Keep-alive live park stays for real ACP gates (authored `agent` mode).
- 2026-07-24 · **Set the Codex ACP session mode with `session.setConfigOption("mode", <mode>)`,
  applied right after `applyModel` in acquire, best-effort.** This is the spike-proven channel;
  `session.setMode(modeId)` is the ACP-standard sibling and also exists, `INITIAL_AGENT_MODE` is an
  unverified daemon-env alternative (skip it). The default `agent-full-access` needs no wire field
  (apply it for every Codex run); the per-agent OVERRIDE needs one — a dedicated typed
  `harnessMode` field beats a generic blob (design-interfaces discipline). Never fail the run on a
  mode-application error.
- 2026-07-24 · **The daemon SDK normalizes codex's per-gate option ids to `once/always/reject`.**
  Codex exec gates offer `allow_once/allow_always/accept_execpolicy_amendment/reject_once` and MCP
  gates offer `allow_once/allow_session/allow_always/decline`, but the daemon presents
  `availableReplies: ["once","always","reject"]` and `respondPermission(id,"once"|"reject")` maps to
  the right option (never the persistent "always"). So the shared `decisionToReply` needs no
  codex-specific reply mapping. The codex-specific work is IDENTITY recovery: MCP permission frames
  are nearly empty (`_meta.is_mcp_tool_approval`, no rawInput) so recover name+args from the recorded
  `tool_call` event by `toolCallId`; exec frames key on `rawInput.command` like Claude's Bash.
- 2026-07-24 · **Enable the executable-tool gate only for a LOCAL non-Pi harness
  (`!plan.isPi && !plan.isDaytona`) and make the deferred gate fail closed (deny) when unset.** The
  Daytona in-sandbox stdio shim path is a separate delivery route; leave it untouched until a
  dedicated Daytona milestone. Reuse the `deferred*Ref` pattern (like `deferredClientToolRelay`) so
  the per-turn gate is swapped in via `currentTurn` without re-attaching session listeners.
- 2026-07-24 · **Rebuild the deployment FROM THE WORKTREE root.** `run.sh --env-file
  .env.ee.dev.local` resolves the env relative to the cwd, and the main checkout's copy targets a
  different `COMPOSE_PROJECT_NAME` than the worktree's. Running from the main root rebuilds the wrong
  compose project (someone else's runner). Always `cd <worktree>` first, and verify the recreate hit
  `agenta-ee-dev-codex-harness-runner-1`.
- 2026-07-24 · **Codex daemon "Internal agent error: Internal error" = the codex app-server failed,
  surfaced through `acp-http-client`; it is NOT a runner-code error.** When it fires only on sessions
  that carry an MCP server (baseline chat is fine) and before any tool_call, suspect the codex
  daemon's connection to the internal loopback HTTP MCP server / the container environment, not the
  gate logic. Isolate by loading the last-known-good runner commit into the mounted `src` and
  restarting: if that also fails, it is a deployment regression, not your change. (Full daemon detail
  does not reach the runner logs — only the wrapped "Internal error" does.)
- 2026-07-24 · **Never render an approval-only `[mcp_servers.<name>]` table into codex
  `config.toml` for a server delivered via ACP `session/new`: codex validates every config
  `mcp_servers` entry at load and a transport-less one (`no command`/`url`) kills EVERY session with
  `Error loading config.toml: invalid transport`, surfaced only as the generic `-32603 Internal
  agent error: Internal error` on `session/new`.** This supersedes the previous entry's "it is a
  deployment regression, not your change" verdict: that exact symptom (tool runs fail pre-tool_call,
  chat fine, survives rebuilds and a runner-code revert) was SDK-side config emission — reverting
  the runner is not a full revert because `codex_settings.py` runs in the services container. To see
  the real error, run `codex exec` directly against the recovered `$CODEX_HOME` (the geesefs mount
  is retrievable from the seaweedfs filer after teardown), or flip the suspect config file on/off in
  an in-container `sandbox-agent` driver.

## Milestone 3 — QA debugging (invalid control + resume key)

- 2026-07-24 · **The SDK is bind-mounted into the SERVICES container, the runner code into the
  RUNNER container. A config.toml bug lives in the SDK.** When a live tool run fails, "roll back the
  runner to the last-good commit and see if it still fails" is an INVALID control for anything the
  SDK renders (harnessFiles like `.codex/config.toml`): the services container keeps serving the
  new SDK. Isolate an SDK-rendered artifact by editing the bind-mounted SDK + restarting SERVICES,
  not by reverting the runner. (This cost a full misdiagnosis as a "deployment regression".)
- 2026-07-24 · **Codex 0.145 validates EVERY `[mcp_servers.<name>]` config entry for a transport
  at `session/new`.** A permission-only table (`default_tools_approval_mode` / per-tool
  `approval_mode` with no `command`/`url`) is rejected with `invalid transport in
  'mcp_servers.<name>'`, surfaced as the generic `Internal agent error: Internal error`, killing
  the session before any prompt. Never render approval-only server tables for ACP-delivered servers.
  The spike Q3 "parses cleanly" probe missed this because it always ran the table ALONGSIDE a
  transport-bearing entry. (Forensics: codex `$CODEX_HOME` lands on the geesefs mount and is
  recoverable via the seaweedfs filer after teardown; daemon logs at `~/.local/share/sandbox-agent/logs/`.)
- 2026-07-24 · **The runner-side ask gate keys the stored decision on the codex MCP `arguments`,
  but the traced tool_call event carries codex-acp's `{server,tool,arguments}` wrapper.** So a
  cross-turn approval re-parks unless you unwrap that wrapper symmetrically in
  `storedDecisionKeyShape` (both the gate key and the `{approved}`-decision key must hash the same).
  Live QA caught this; unit tests missed it because they used consistent args on both sides.
- 2026-07-24 · **A runner restart cannot force a cold resume for a LOCAL sandbox.** The restart
  gives the runner a new replica id, and the local single-owner guard refuses to move the session
  (`local sandbox requires a single runner ... Refusing to cold-start on the wrong host`). That is
  correct. For the runner-side MCP-seam gate the pause tears the session down anyway, so every
  resume already cold-creates (`create_session mode=create`) on the owning replica — that IS the
  cold-replay path. A true cross-replica cold resume is a Daytona (durable-sandbox) concern.
- 2026-07-24 · **Multi-session on one worktree/stack: commit fixes IMMEDIATELY.** A concurrent
  orchestrator's git operation reverted this session's uncommitted resume-key fix (the running
  runner kept it in memory, masking the loss), and its runner restarts errored in-flight resumes.
  Commit each fix the moment it's green, and re-run QA batches in stable windows; check
  `docker ps` uptime before a batch.

## Milestone 4 (subscription auth)

- 2026-07-24 · **`CODEX_CONFIG` cannot neutralize the operator's `config.toml` MCP servers — it
  deep-merges (union), additive only.** Verified: `{"mcp_servers":{}}` leaves the operator's servers
  intact; a non-empty override yields BOTH sets. So mounting the operator's whole `~/.codex` as
  `CODEX_HOME` (the D-002 subscription design) leaks their `[mcp_servers.*]`, `[plugins.*]`, and
  `[apps.*]` into every product session, and there is NO config override that removes them. If you
  need the operator's login but not their config, mount only `auth.json` (P4: codex rewrites it in
  place through a symlink/bind, so refresh still lands in the real login) and let the runner own
  `config.toml`. Treat "mount the whole login dir" as a product-exposure decision, not a default.
- 2026-07-24 · **Subscription `CODEX_HOME` is already delivered by `buildDaemonEnv`** (it copies
  `process.env.CODEX_HOME` on every run, exactly like `CLAUDE_CONFIG_DIR`). So the subscription
  branch of `configureCodexHome` must do NOTHING to `CODEX_HOME` (overriding it to `<cwd>/.codex`
  would break refresh-into-the-real-login). It only sets `CODEX_SQLITE_HOME`. Managed mode is the
  one that sets `CODEX_HOME`.
- 2026-07-24 · **Keep `CODEX_SQLITE_HOME` redirect in BOTH modes.** In subscription mode the mount
  IS the operator's real login; without the redirect, every product run dumps WAL SQLite into it.
  Verified redirect works on the deployment (run SQLite lands in `/tmp/agenta/codex-sqlite/…`). Note
  the mounted `~/.codex/*.sqlite` still churns from the operator's OWN concurrent host codex use —
  do not mistake that for the redirect failing; check the off-mount dir for YOUR run's session id.
- 2026-07-24 · **The codex `self_managed` on-ramp is one line in `capabilities.py`** (`codex`
  harness `connection_modes` → `list(_ALL_MODES)`). The connection resolver maps
  `self_managed → runtime_provided` generically; no per-harness wiring. Restart `services` AND `api`
  after editing `capabilities.py` (both bind-mount `sdks/python`; uvicorn reload only watches `/app`).
- 2026-07-24 · **Mount the login into THIS project's runner via a gitignored
  `docker-compose.dev.*.local.yml`** (run.sh auto-includes it), mirroring the Pi
  `${HOME}/.pi/agent:/pi-agent:rw` mount: `${HOME}/.codex:/codex-home:rw` + `CODEX_HOME=/codex-home`.
  The runner runs as root with no `OPENAI_API_KEY`, so a subscription run inherits no key. Recreate
  with `--recreate runner` (no rebuild needed for a compose-only mount change).

## Milestone 4 amendment (symlink assembly for the config leak)

- 2026-07-25 · **Mounting the operator's whole login dir as the session home leaks their config;
  the fix is the SYMLINK ASSEMBLY, not `CODEX_CONFIG`.** Point the subscription daemon's CODEX_HOME
  at a runner-owned per-session dir (`<cwd>/.codex`, same as managed) and symlink ONLY `auth.json`
  into it from the mount. Codex rewrites auth.json in place and follows the symlink (P4), so refresh
  still lands in the operator's real login, while their `config.toml`/`plugins`/`apps` never load.
  Teardown must unlink the LINK, never the target (`rmSync`/`unlink` on a symlink is safe; never
  `rm -rf` the resolved path). This generalized cleanly: `configureCodexHome` now sets
  `CODEX_HOME=<cwd>/.codex` in BOTH modes; the only per-mode branch is the auth SOURCE (write the
  resolved key vs symlink the mount) plus the subscription store-mode pin.
- 2026-07-25 · **The mount path for the symlink target is `process.env.CODEX_HOME`, captured BEFORE
  `configureCodexHome` overrides the daemon `env.CODEX_HOME`.** `configureCodexHome` mutates the
  daemon env object, not `process.env`, so a later post-mount step can still read the operator's
  mount path from `process.env.CODEX_HOME`.
- 2026-07-25 · **Product-path subscription+tools QA = flip m3-qa's `connection.mode` to
  `self_managed`.** The resolver maps it to `runtime_provided` and the run authenticates from the
  mount; everything else (the `list_connections` platform tool, the internal agenta-tools MCP
  server) is identical. `spike/scripts/m4-tool-qa.py` is that one-line variant.
- 2026-07-25 · **The pre-commit hook reformats `uv`-script `# /// script` files (ruff) and ABORTS
  the commit.** Re-add and re-commit; don't assume the first `git commit` landed (verify HEAD moved).
- 2026-07-25 · **To QA/record the runner-side tool gate in the PRODUCT UI, drive it with the
  agent-level `Permissions` policy on a RUNNER-executed tool — not a per-tool permission on a
  schema-only tool.** In the playground, `Advanced -> Permissions -> Policy` offers
  `Allow reads` / `Allow all` / `Ask` / `Deny all` ("what the agent may do on its own before it must
  ask"); these map straight onto the gate's allow/ask/deny decisions and fire for runner-executed
  tools (platform ops, referenced workflows, MCP), surfacing over the internal `agenta-tools` channel
  as `mcp.agenta-tools.<tool>`. Under `Ask` the UI renders a real "Approval needed to continue" card
  with Approve/Deny + the payload; Approve resumes (cold-replay) and executes, Deny refuses and the
  turn continues to a clean answer. A "schema-only / executed by your app" custom tool is a CLIENT
  tool that goes through the client-tool relay, NOT the runner gate: it returns
  `{"status":"not_handled"}` ("not handled by this client") and never touches the gate — so its
  per-tool Allow/Ask/Deny selector is meaningless for gate QA. Use a referenced workflow (e.g. the
  built-in `exact-match` evaluator) as the gated tool.
- 2026-07-25 · **Under `Ask`, a persistent model re-issues the same tool call every turn and it
  re-parks each time (Ask asks EVERY call) — that loop is expected, not a bug.** Approving executes
  one call; the model may call again and park again. To reach a clean final reply for a recording,
  Deny once (the model then answers without the tool) or switch the policy to `Allow all`.
- 2026-07-25 · **chrome-devtools MCP quirks for the Lexical chat editor + screenshots.** (1) The
  playground chat box is a Lexical `contenteditable`; `fill`-by-uid can land text in a HIDDEN sibling
  tab's editor after any tab/session switch. Verify the VISIBLE editor got it
  (`[contenteditable=true]` with `offsetParent!==null`) and click the enabled Send, or take a fresh
  snapshot to get the current input uid immediately before filling. (2) `take_screenshot filePath`
  only writes inside the workspace root — capture into the worktree, then copy to any external
  jobs/tmp frames dir.
- 2026-07-25 · **Daytona: the daemon env is FIXED at sandbox creation.** Config-dir env vars
  (`CODEX_HOME`, `CODEX_SQLITE_HOME`, the Claude/Pi equivalents) must be set BEFORE the provider is
  built, into the env object that becomes the sandbox's `envVars` (the runner threads them through
  `piExtEnv`, which doubles as the Daytona daemon-env carrier for non-Pi harnesses). You cannot
  change the daemon env after the sandbox exists. The credential FILE, by contrast, is written AFTER
  the sandbox starts, through the sandbox filesystem API (`mkdirFs` + `writeFsFile`), not host `fs`.
- 2026-07-25 · **Daytona: put the managed credential home IN-VM, never on the durable cwd.** The
  Daytona cwd is a geesefs mount of durable S3, and teardown pauses or destroys the sandbox before
  any per-run file backstop could delete a key written under the cwd, so a key on the cwd can outlive
  the run in the store (and a parked sandbox keeps it). Writing the home to an in-VM path
  (`/home/sandbox/agenta/...`, a sibling of the relay/tool-MCP dirs) makes it reaped with the sandbox
  by construction — the strongest form of "delete the key at session end." This also removes the need
  for a separate off-mount SQLite redirect on Daytona (the in-VM home already keeps SQLite off the
  mount), though keeping the explicit redirect for parity with the local path is harmless.
- 2026-07-25 · **The Daytona snapshot ships its own harness version, independent of the runner-image
  pin.** A managed Daytona run failed the model check with an OLDER model list than the local runner
  offered: the snapshot's bundled harness CLI predates the runner-pinned adapter. The image pin
  (`install-agent <harness> --agent-process-version`) covers the RUNNER image only; the sandbox
  snapshot is a separate image built elsewhere and needs the same pin applied to its recipe. Expect
  the local and Daytona model catalogs to diverge until both are pinned.
- 2026-07-25 · **`install-agent <harness> --agent-process-version <v>` pins via the generated
  lockfile, not the manifest.** The daemon still writes a caret range (`^<v>`) into `package.json`;
  the real pin is the `package-lock.json` (lockfileVersion 3) it generates with the exact version and
  integrity hash. Bake the install into the image as the RUNTIME user so the install dir
  (`$HOME/.local/share/sandbox-agent/bin/agent_processes/<harness>`) matches at run time; pin `HOME`
  so an arbitrary uid cannot miss the baked pin. An open-source harness CLI is bakeable; a
  proprietary one (Claude Code) must stay a runtime install by its vendor.
- 2026-07-25 · **Release gate: SKIP the harness-shaped probes that do not fit, do not FAIL them.**
  The gate's `approve`/`deny` drive a builtin `bash` command with `ask`; a harness whose default mode
  runs shell gateless and enforces tool approvals runner-side (the `agenta-tools` pause seam) never
  fires a native `tool-approval-request`, so those journeys must SKIP with a reason, not FAIL. The
  `mount` probe reads its token from a builtin-shell `tool-output-available` payload; a harness that
  runs shell through native exec frames lands its output in a different field, so that probe also
  SKIPs (a harness-shaped mount probe is the follow-up). Mirror the existing Claude-only `mcp` SKIP.
- 2026-07-25 · **Managed connection resolver: an explicit-slug lookup can fail while slug-None
  works.** A managed connection `{mode: agenta, slug: "<name>"}` returned "connection '<name>' not
  found for provider '<provider>'" while the default `{mode: agenta, slug: None}` path (which the
  release-gate probe uses) resolved fine. The vault secret existed. This is a deployment/EE
  connection-resolution trap, harness-independent, not runner code — verify the product path with a
  slug-None managed cell before assuming your harness broke it, and drive the runner `/run` directly
  (key in `secrets`, `credentialMode=env`) to isolate the harness code from the resolver.
- 2026-07-25 · **A coding harness may take an API key with NO credential file — enumerate the
  mechanism space before building a file-writer.** Codex's BUILT-IN openai provider hard-requires a
  login/auth.json, but a CUSTOM `model_providers` entry with `env_key = "OPENAI_API_KEY"` makes codex
  read the key from process env at REQUEST time and write nothing. It must be a NEW provider id
  (built-ins are not overridable) and it must live in the config FILE (the auth-gate check reads the
  app-server's own config, not an env-delivered override). This retired three milestones of
  auth.json-writer + delete-backstop machinery (including an ordering bug where the backstop ran
  after the durable unmount and stranded the key in the store). Lesson: when a harness needs a
  credential, list EVERY provisioning channel (file, env-at-request, ephemeral store, gateway
  header, bearer config, ...) and prefer the one that keeps the secret in exactly one place (the env
  var) with nothing on disk — it also composes best with a placeholder/egress-proxy secret design.
- 2026-07-25 · **File-free managed auth beats "write-then-delete on durable storage".** For a durable
  session home on remote/S3-backed storage, an add-then-remove credential lifecycle has an
  irreducible crash window (the key persists if the process dies before teardown) and a delete that
  must run BEFORE the unmount/sandbox-stop. If the harness can read the key from env at request time,
  the file never exists, so there is nothing to delete, no crash window, and native session resume
  (rollouts on the durable mount) is preserved. Redirect only the unavoidable on-disk state
  (SQLite/WAL) off the mount; keep the credential in env.
- 2026-07-25 · **The managed-vs-subscription signal is "not subscription", not "== env".** The runner
  keys managed on `credentialMode !== "runtime_provided"`, so an unresolved/absent credential mode
  counts as managed. When rendering credential-mode-dependent config in the SDK, mirror that: default
  to managed unless the resolved connection (or the authored `self_managed` intent) says subscription
  — otherwise an un-migrated or unresolved run silently loses its auth config.
- 2026-07-28 · **Reports and QA artifacts are public the moment the PR opens — no deployment IPs,
  hostnames, project ids, or account emails in committed files.** Milestone reports naturally quote
  the live QA environment ("open http://<ip>:<port>"); once the design workspace ships with the PR,
  that address is public. Write `http://<dev-host>:<port>` placeholders from the first draft (the
  real address belongs in the chat/session, or an untracked local note), and check recordings for
  the browser URL bar before committing them. Scrubbing after the fact still leaves the value in git
  history and in the PR diff views.
