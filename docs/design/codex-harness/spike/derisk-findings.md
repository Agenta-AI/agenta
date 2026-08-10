# Codex harness derisk probes — P1-P5

Date: 2026-07-24. Follow-up to [findings.md](findings.md); same method (real `sandbox-agent`
daemon from `services/runner/node_modules`, `SandboxAgent.start(local({env}))` →
`createSession({agent:"codex"})` → `prompt`), same driver [`scripts/drive.mjs`](scripts/drive.mjs)
(extended with a `configOptions` scenario key), model `gpt-5.6-luna`. Scenario inputs are in
[`scenarios-derisk/`](scenarios-derisk/) (no secrets — API keys ride only in throwaway
`/tmp/codex-derisk/home-*/auth.json`), raw transcripts in [`transcripts/`](transcripts/).
Source citations are `openai/codex` at tag `rust-v0.145.0` (the codex CLI bundled inside
codex-acp 1.1.7 is 0.145.0) and the installed adapter bundle
`~/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/@agentclientprotocol/codex-acp/dist/index.js`.

## Verdicts, one screen

| # | Question | Verdict |
|---|---|---|
| P1 | Per-run CODEX_CONFIG under warm pooling | **TRUE** — CODEX_CONFIG is daemon-start-fixed, but the runner pools whole daemons per `<projectId>:<sessionId>` and evicts to a fresh daemon on any config/credential change, so per-run delivery works — provided every input to CODEX_CONFIG is covered by `configFingerprint` (or the secrets epoch) |
| P2 | What does on-request gate under danger-full-access | **NOTHING** — on this path real full access exists only via the adapter's `mode=agent-full-access`, which hard-couples `approval_policy=never` per turn; no exec, outside-write, or MCP gate fires, and CODEX_CONFIG `untrusted` cannot bring gates back. D-003's default gives no HITL in practice; HITL exists only in workspace-write mode |
| P3 | Placeholder credential compatibility | **YES, opaque_http** — arbitrary-format key from auth.json sent verbatim as `Authorization: Bearer dtn_secret_placeholder_abc123` to `<base_url>/responses`; no client-side format validation; auto-login writes auth.json without any validation call. Caveat: codex tries a WebSocket upgrade first |
| P4 | auth.json refresh write style | **In-place truncate+write (no temp+rename) → a symlinked auth.json survives a token refresh** — `FileAuthStorage::save`, and File is the default store mode |
| P5 | Env clear-then-apply under warm reuse | **By daemon replacement, never mutation** — env is baked at daemon start; a credential or config change fails the continuation check and evicts to a cold start with a freshly built env. Warm reuse only ever happens when secrets hash AND config fingerprint match, so stale env can never serve different credentials |
| P6 | Can MCP tool-level `prompt` config force HITL under `agent-full-access` | **NO** — server-level `default_tools_approval_mode="prompt"`, per-tool `approval_mode="prompt"`, and `"writes"` all run gate-free under full access; the same config gates fine under the default `agent` mode (control). "Full access for shell, HITL for tools" is not expressible in codex config on this adapter |
| P7 | Can codex's bwrap sandbox work inside the runner container | **YES, but only with host-granted privileges we control locally and Daytona does not give us**: minimal working set = `--security-opt seccomp=unconfined --security-opt apparmor=unconfined --cap-add SYS_ADMIN --cap-add NET_ADMIN` (or `--privileged`); every lesser combination fails, and the bare HOST fails too (Ubuntu 24.04 `apparmor_restrict_unprivileged_userns=1`) |
| P8a | Can codex state move out of CODEX_HOME | **YES, supported redirect**: env `CODEX_SQLITE_HOME` / config key `sqlite_home` moves ALL four SQLite families (`state_5`, `goals_1`, `logs_2`, `memories_1` + `-wal`/`-shm`) off the home; rollouts/auth/config stay. WAL is hardcoded (`SqliteJournalMode::Wal`) |
| P8b | Does post-daemon-death resume need the CODEX_HOME state | **YES — and specifically the PLAIN-FILE part**: same home ⇒ native `session/load` + context retained; fresh home ⇒ silent fallback to a new thread, context lost. Same home + FRESH `CODEX_SQLITE_HOME` ⇒ native resume still retains context — resume rides the `sessions/` rollouts, not the sqlite |
| P8c | Claude parity on durable runs | Claude's home is NEVER on the geesefs cwd: local = runner container's own disk; Daytona = only `~/.claude/projects` (plain jsonl transcripts) is geesefs-mounted. Claude's native resume depends on those transcript files — an ephemeral codex home would be a REGRESSION vs Claude; cwd-home+sqlite-redirect is parity-or-better |
| P8d | WAL-off SQLite on geesefs | **Skipped per P8a**: journal mode is hardcoded WAL at codex's shared SQLite connection layer; there is no knob to test against |

---

## P1 — CODEX_CONFIG granularity under session reuse

**Verdict: per-run CODEX_CONFIG is possible with the current pooling (TRUE), because the pooling
granularity is the whole daemon, and daemon replacement is the config-change path.**

At which granularity is CODEX_CONFIG fixed:

- **Daemon start.** The adapter reads it once at process startup: `startAcpServer()` does
  `const configString = process.env["CODEX_CONFIG"]` (codex-acp bundle line 31120) and the parsed
  object is closed over for every subsequent `session/new` (merged into the thread config in
  `createSessionConfig`, bundle ~26386).
- **No per-session env channel exists.** ACP `NewSessionRequest` is only
  `{cwd, additionalDirectories?, mcpServers, _meta?}` (`@agentclientprotocol/sdk`
  `dist/schema/types.gen.d.ts:4621`), and the daemon SDK's `createSession` takes
  `sessionInit?: Omit<NewSessionRequest, "_meta">` plus id/agent/model/mode/thoughtLevel — no env.
- **Empirical** (`transcripts/p1-two-sessions.jsonl`): ONE daemon started with
  `CODEX_CONFIG='{"approval_policy":"untrusted"}'` while the CODEX_HOME `config.toml` said
  `approval_policy="never"`. Three sessions created on that daemon; the untrusted gate fired in
  **all three** (`verdict-data: gatesA=1 gatesB=1 gatesC=1`), including session C whose
  `sessionInit` smuggled `env`/`_meta.env` overrides back to `never` — dead letters.

How the runner pools (`services/runner/src/engines/sandbox_agent/`):

- The pool unit is the **whole environment**: daemon process + ACP session + mounts, parked in
  `SessionPool` under key `<projectId>:<sessionId>` (`session-identity.ts poolKeyFor`). A warm
  continuation reuses BOTH the daemon and the session (`server.ts` `checkoutIdle` →
  `runTurn(live.environment, ...)`); the daemon is never shared across pool keys and a parked
  daemon never gets a second `createSession` from the runner.
- Continuation is only taken when `configFingerprint` (harness, sandbox, model, provider,
  connection, deployment, endpoint, credentialMode, agentsMd, prompts, tools, skills, mcpServers,
  permissions, sandboxPermission, harnessFiles, workflow revision — `session-identity.ts:142`)
  AND `credentialEpoch.secretsHash` (sha256 over resolved secret values) AND the history
  fingerprint all match. Any mismatch → `pool.evict` → `coldAndPark()` → `acquireEnvironment` →
  a **new** `SandboxAgent.start` with a freshly built env (`server.ts:565-590`).

So: deliver per-run config as `CODEX_CONFIG` in the daemon env, and warm reuse is automatically
correct — a run with different config never lands on the old daemon. **The one rule this imposes:**
every request field that feeds the CODEX_CONFIG value must be part of `configFingerprint` (or
`request.secrets`). All the plausible inputs (model, permissions, sandboxPermission,
credentialMode, connection, endpoint) already are. A CODEX_CONFIG derived from anything outside
the fingerprint would silently stick across warm turns.

Additional channel discovered: the ACP **session config options** work on the daemon path
(`session.setConfigOption("mode", "agent-full-access")` verified in the e-round below), giving
true per-SESSION granularity for the adapter-exposed subset (`mode`, `model`,
`collaboration_mode`). Arbitrary config.toml keys stay daemon-scoped.

## P2 — Gate texture when the inner sandbox is off

**Verdict: on-request gates NOTHING under real danger-full-access, because on this path
danger-full-access is inseparable from approval never. D-003's "approval_policy=on-request +
sandbox_mode=danger-full-access" is not a reachable combination.**

The pivotal mechanism (adapter source): codex-acp sends `approvalPolicy` and `sandboxPolicy`
**per turn** from its ACP `mode` preset, overriding the session's file/env `sandbox_mode`
(`AgentMode` class, bundle ~25806-25856; `sendPrompt` passes
`approvalPolicy: agentMode.approvalPolicy, sandboxPolicy: agentMode.sandboxPolicy` into
`runTurn`, bundle 26549):

| ACP `mode` option | turn approval | turn sandbox |
|---|---|---|
| `read-only` | on-request | read-only |
| `agent` (default) | on-request | workspace-write (network off) |
| `agent-full-access` | **never** | danger-full-access |

Empirical matrix (a-round = `config.toml` only; b-round = same via `CODEX_CONFIG`; e-round =
`setConfigOption("mode","agent-full-access")`; gates counted from `permission-request` frames):

| Scenario | Config route | Gates | Evidence |
|---|---|---|---|
| on-request + normal `echo` | file `danger-full-access` (d1) / CODEX_CONFIG (d1b) | 0 / **1** | sandbox STILL attempted both times — d1 returned the bwrap error as the answer; d1b gated with "The sandbox failed before running the requested shell command. May I rerun it with the required permissions?" (`d1-…`, `d1b-…`) |
| on-request + outside-workspace write | d2 / d2b | **1 / 1** | reason "Do you want to allow creating … outside the workspace?"; allow → file created (`d2-…`, `d2b-…`) |
| untrusted + normal | d3 / d3b | **1 / 0(!)** | d3 gated; d3b (CODEX_CONFIG carrying BOTH `untrusted` + `danger-full-access`) fired NO gate and still ran sandboxed — see poison combo below (`d3-…`, `d3b-…`) |
| MCP under on-request | d4 / d4b | **1 / 1** | `is_mcp_tool_approval: true` frame; allow → `SPIKE_ECHO_RESULT` returned (`d4-…`, `d4b-…`) |
| MCP `default_tools_approval_mode="approve"` under untrusted | d5 / d5b | 0 / 0 | pre-allow works exactly as in the first spike (`d5-…`, `d5b-…`) |
| **full access** + normal / outside write / MCP / +CODEX_CONFIG untrusted | e1 / e2 / e3 / e4 | **0 / 0 / 0 / 0** | mode accepted (`set-config-option` → `currentValue: "agent-full-access"`); clean output, no bwrap, outside file created, MCP ran; CODEX_CONFIG `untrusted` did NOT restore gates (`e1-…` … `e4-…`) |

What this means:

1. **Neither `config.toml` nor `CODEX_CONFIG` can turn the inner sandbox off** on the daemon
   path — the adapter's per-turn `sandboxPolicy` (workspace-write under the default mode) wins.
   The only real full-access switch is the ACP `mode` config option.
2. **Full access ⇒ approval never, not overridable.** With `mode=agent-full-access` there is no
   HITL of any kind: exec, outside-workspace writes, and MCP tool calls all run silently (e1-e4).
   If the product wants sandbox-off + gates, that combination does not exist on this adapter
   today. D-003 must be restated: either (a) keep the default `agent` mode (workspace-write) and
   accept that the broken bwrap turns approvals into "sandbox failed, may I rerun?" escalation
   prompts on effectively every write-ish command (that IS on-request HITL in practice, but
   noisy and nondeterministic — d1 vs d1b show codex sometimes just reports the bwrap stderr as
   output instead of asking), or (b) accept no HITL under full access and rely on the container
   boundary + MCP-side controls, or (c) ask upstream for a decoupled mode.
3. **Poison combo warning:** `CODEX_CONFIG='{"approval_policy":"untrusted","sandbox_mode":"danger-full-access"}'`
   (d3b) silently disabled ALL approval gates while the turn still ran under the (failing)
   workspace-write sandbox — looser than either key alone and different from the same pair in
   `config.toml` (d3, which gated). Never ship `sandbox_mode` inside CODEX_CONFIG.
4. MCP gating texture is independent of the exec story only until full access: under
   `agent`-mode policies MCP calls gate (d4b) and per-server pre-allow works (d5b); under full
   access MCP never gates (e3).

## P3 — Placeholder credential (Daytona Secrets egress-proxy design)

**Verdict: YES — codex credentials are `opaque_http` in the #5223 sense.** Evidence
(`transcripts/p3-listener-capture.jsonl`, produced by [`scripts/p3-listener.mjs`](scripts/p3-listener.mjs);
runs `p3a*`/`p3b*`):

1. **No client-side format validation.** `auth.json` seeded with
   `{"auth_mode":"apikey","OPENAI_API_KEY":"dtn_secret_placeholder_abc123"}` (no `sk-` prefix):
   codex started the session and issued model requests normally. (First-round runs p3a/p3b, which
   went to the real `api.openai.com`, prove the same end-to-end: OpenAI's own 401 echoed the
   masked placeholder `dtn_secr*****************c123`.)
2. **Header is byte-exact.** Every request the local listener captured carried
   `authorization: Bearer dtn_secret_placeholder_abc123` — verbatim, no mangling (26 requests).
3. **Auto-login does not validate.** With `DEFAULT_AUTH_REQUEST='{"methodId":"api-key"}'` and the
   placeholder in `OPENAI_API_KEY`, the adapter wrote `auth.json` containing the placeholder
   verbatim BEFORE any HTTP traffic of its own (auth.json mtime 17:28:54.841 precedes the run's
   first listener hit 17:28:54.926; the only endpoint ever hit was `/responses` — no probe/login
   call). It also wrote it in round one when the key was demonstrably invalid at the real API.
4. **Endpoint + transport shape.** With an API key, requests go to `<base_url>/responses`;
   default base_url is `https://api.openai.com/v1`
   (`codex-rs/model-provider-info/src/lib.rs to_api_provider`: ChatGPT-auth modes default to
   `CHATGPT_CODEX_BASE_URL`, everything else `"https://api.openai.com/v1"`). Override is the
   `openai_base_url` config key (`codex-rs/config/src/config_toml.rs:379`) — a config.toml/
   CODEX_CONFIG key, NOT an env var — and it is on the project-local config **denylist**
   (`codex-rs/config/src/loader/mod.rs PROJECT_LOCAL_CONFIG_DENYLIST`), so a repo checked into
   the workspace cannot redirect credentials (mitigates spike risk 1 for creds).
5. **Caveat for the egress proxy: WebSockets first.** Codex 0.145 attempts a WebSocket upgrade to
   the same `/responses` URL (GET + `upgrade: websocket`, retried ~7 times over ~7s), then falls
   back to plain HTTP POST with the warning "Falling back from WebSockets to HTTPS transport".
   The upgrade request carries the same Authorization header, so header substitution at the
   proxy still works — but the proxy must either substitute-and-forward the upgrade or reject it
   fast; a proxy that silently blocks ws adds the multi-second fallback dance to every request
   (the openai provider has `supports_websockets: true`).

## P4 — auth.json refresh write style

**Verdict: rewritten IN PLACE (open + truncate + write, no temp-file+rename) → a symlinked
auth.json survives a token refresh, and the refreshed tokens land in the symlink's target.**

Source, `openai/codex` @ `rust-v0.145.0`:

- `codex-rs/login/src/auth/storage.rs`, `FileAuthStorage::save` (impl `AuthStorageBackend`):

  ```rust
  fn save(&self, auth_dot_json: &AuthDotJson) -> std::io::Result<()> {
      let auth_file = get_auth_file(&self.codex_home);          // CODEX_HOME/auth.json
      ...
      let mut options = OpenOptions::new();
      options.truncate(true).write(true).create(true);
      #[cfg(unix)] { options.mode(0o600); }
      let mut file = options.open(auth_file)?;
      file.write_all(json_data.as_bytes())?;
      file.flush()?;
      Ok(())
  }
  ```

  No `rename`, no temp file; `OpenOptions::open` follows symlinks (no `O_NOFOLLOW`), so the write
  goes through the link into the target inode. (`mode(0o600)` applies only on create.)
- The refresh path persists through exactly this backend:
  `codex-rs/login/src/auth/manager.rs` `persist_tokens(...)` — loads `auth_dot_json`, swaps
  `id_token`/`access_token`/`refresh_token`, sets `last_refresh = Utc::now()`, then
  `storage.save(&auth_dot_json)`.
- The file backend is the **default**: `codex-rs/config/src/types.rs:106-119`,
  `enum AuthCredentialsStoreMode { #[default] File, Keyring, Auto, Ephemeral }`.

Caveats: if an operator ever sets `cli_auth_credentials_store = "keyring"` / `"auto"` and a
keyring is reachable, the keyring paths DELETE the auth.json file after saving
(`delete_file_if_exists`), which would remove the symlink itself — irrelevant in headless
containers (no keyring; Auto falls back to file) but worth pinning the store mode to `file`.

## P5 — How per-run env reaches codex under warm reuse

**Verdict: it doesn't reach a live daemon at all — the runner applies new env exclusively by
tearing the old daemon down and starting a new one, and the continuation checks make it
impossible for a warm daemon to serve a run whose credentials or config differ.**

The exact mechanism (code reading, `services/runner/src/engines/sandbox_agent/`):

1. **Baking:** `environment-setup.ts:171-176` builds the daemon env once per acquire —
   `buildDaemonEnv(plan.acpAgent, {clearProviderEnv: credentialMode === "env", provider,
   deployment})` then `Object.assign(env, plan.secrets)` — and `provider.ts:150` hands it to
   `local({ env, binaryPath })`; `environment.ts` `SandboxAgent.start(...)` spawns the daemon
   with it. Clear-then-apply lives in `daemon.ts buildDaemonEnv`: managed runs copy NO
   `KNOWN_PROVIDER_ENV_VARS` (the resolved `plan.secrets` are the only provider env);
   non-managed runs inherit only the declared provider's group — and
   `PROVIDER_ENV_VAR_GROUPS["openai-codex"]` is `[]`, so a codex-subscription run inherits no
   provider env key at all (its login is the CODEX_HOME auth.json).
2. **Reuse:** two consecutive runs on the same `<projectId>:<sessionId>` reuse the same daemon
   process AND ACP session only if `server.ts:565-590` finds no mismatch among:
   `configFingerprint` (includes `credentialMode`, `provider`, `connection`, `endpoint`, …),
   `credentialEpochMismatch` (sha256 over the resolved secret VALUES + mount-credential expiry,
   `session-identity.ts:313-390`), the history fingerprint, and a fresh-user-tail check.
3. **Switch:** different vault key → `secretsHash` differs → evict reason
   `credentials-rotated` → `coldAndPark()`; managed→subscription → `credentialMode` change →
   `mismatch (config)` → same eviction. Either way the next daemon is born with the new env.
   The eviction is awaited before the cold acquire (teardown unmount must not overlap the
   remount), and a no-scope request never parks at all (`poolKeyFor` null ⇒ fully cold).

So "warm reuse keeps stale env" is true only in the harmless sense that an *identical* run
(same secrets hash, same config) continues on the daemon born with those values. Any
difference that matters is structurally forced onto the cold path. For CODEX_CONFIG this makes
the daemon-env delivery channel per-run-correct by construction (P1).

## P6 — MCP per-tool approval config vs `agent-full-access`

**Verdict: NO — under `mode=agent-full-access`, explicit per-server and per-tool "prompt" MCP
approval config is overridden along with everything else; no permission request ever fires.**
"Full access for shell, HITL for Agenta tools" cannot be expressed through codex MCP config on
this adapter.

All runs: same MCP echo server, same prompt, model `gpt-5.6-luna`,
`setConfigOption("mode","agent-full-access")` accepted (`currentValue: "agent-full-access"` in
each transcript), tool call proven executed by the MCP server's own request log
(`tools/call` received; `SPIKE_ECHO_RESULT:hello-derisk` returned).

| Scenario | MCP approval config (in `config.toml`) | ACP mode | Gates | Transcript |
|---|---|---|---|---|
| f1 | `[mcp_servers.spike] default_tools_approval_mode = "prompt"` | agent-full-access | **0** | `f1-fullaccess-mcp-prompt.jsonl` |
| f2 | `[mcp_servers.spike.tools.spike_echo] approval_mode = "prompt"` | agent-full-access | **0** | `f2-fullaccess-mcp-toolprompt.jsonl` |
| f3 | `[mcp_servers.spike] default_tools_approval_mode = "writes"` | agent-full-access | **0** | `f3-fullaccess-mcp-writes.jsonl` |
| f1c (control) | same as f1 | `agent` (default) | **1** (`is_mcp_tool_approval`) | `f1c-agentmode-mcp-prompt.jsonl` |

The control matters: it proves the `"prompt"` config parses and is honored whenever the mode's
approval policy permits asking — so the f1-f3 zeros are suppression by the full-access mode
(turn-level `approvalPolicy: "never"`), not a config typo or an ignored key. Together with e4
(CODEX_CONFIG `untrusted` also suppressed), the rule is: **under `agent-full-access` nothing can
ask** — exec, outside writes, MCP, regardless of any config layer. If the product wants HITL for
Agenta tools while shell runs free, it has to come from OUTSIDE codex (e.g. the runner's own
tool-MCP gateway pausing on its side) or from staying in `agent` mode.

## P7 — Codex's bubblewrap sandbox inside the runner container

**Verdict: the sandbox CAN initialize in a container from the real runner image, but only with
privileges we can grant locally and Daytona will not: minimum
`--security-opt seccomp=unconfined --security-opt apparmor=unconfined --cap-add SYS_ADMIN
--cap-add NET_ADMIN` (or `--privileged`). Every lesser combination fails — and so does the bare
host, because Ubuntu 24.04 restricts unprivileged user namespaces.**

Method: no model, no daemon — `codex sandbox -c 'sandbox_mode="workspace-write"' -- sh -c ...`
using the codex-acp-bundled musl codex + its **bundled bwrap**
(`…/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/`: `bin/codex`,
`codex-resources/bwrap`), copied into throwaway containers from the LIVE runner's image
(`agenta-ee-dev-runner:latest`, from `docker inspect agenta-ee-dev-codex-harness-runner-1`; the
live container was not touched). Full raw log: `transcripts/p7-bwrap-matrix.log`; reproducible
via [`scripts/p7-bwrap-matrix.sh`](scripts/p7-bwrap-matrix.sh). Argument-parsing note: everything
after `codex sandbox [OPTIONS]` is the command — the mode must ride `-c sandbox_mode=…`, not a
positional arg.

| Where | Docker flags | Failure point / result |
|---|---|---|
| host (no container) | — | `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` (the spike's original error) |
| container | (default) | `bwrap: No permissions to create a new namespace` (docker's default seccomp blocks the userns clone) |
| container | `--cap-add NET_ADMIN` | same as default |
| container | `seccomp=unconfined` (± NET_ADMIN) | `bwrap: Failed to make / slave: Permission denied` (AppArmor `docker-default` denies mount propagation) |
| container | `seccomp=unconfined` + `apparmor=unconfined` (± NET_ADMIN) | `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` (falls through to the HOST's userns restriction, see below) |
| container | `SYS_ADMIN + NET_ADMIN` only | `Failed to make / slave` (AppArmor still) |
| container | `SYS_ADMIN + NET_ADMIN + apparmor=unconfined` | `bwrap: pivot_root: Operation not permitted` (docker's default seccomp blocks `pivot_root` even with the caps) |
| container | **`seccomp=unconfined + apparmor=unconfined + SYS_ADMIN + NET_ADMIN`** | **WORKS** — command ran inside the sandbox (`p7-marker-ran`, rc=0) |
| container | `--privileged` | **WORKS** |

Enforcement sanity check in the minimal working config: an outside-workspace `touch /p7-outside`
fails with `Read-only file system` while a cwd write succeeds — the sandbox is not just
initializing, it enforces.

Root cause of the host/loopback failure: the host runs Ubuntu 24.04 with
`kernel.apparmor_restrict_unprivileged_userns = 1` (verified via sysctl, logged in the matrix
file). Unprivileged user namespaces are allowed but capability-stripped, so bwrap's child netns
lacks `CAP_NET_ADMIN` and cannot bring up loopback (`RTM_NEWADDR` EPERM). With real root +
`SYS_ADMIN`/`NET_ADMIN` (the working configs) bwrap does not need the unprivileged-userns path
at all.

Implications:

- **Local runner**: we control `docker run` flags, so codex's inner sandbox is *achievable* —
  at the price of `SYS_ADMIN` + unconfined seccomp/AppArmor on the runner container, which is a
  materially weaker container boundary. That trade needs its own decision; it is NOT a free fix.
- **Daytona**: container caps/seccomp are outside our control, so this fix does not transfer.
  The cloud posture remains "no inner sandbox" — which, per P2/P6, means gate texture there is
  whatever the ACP mode dictates.
- If the inner sandbox is ever enabled locally, the P2 texture changes again: the
  "sandbox failed, may I rerun?" escalation gates disappear and `workspace-write` becomes a real
  boundary instead of a broken one — re-run the d-matrix before relying on it.

## P8 — CODEX_HOME layout after the M1 geesefs SQLite blocker

Context: M1 live QA ([reports/m1-implementation-notes.md](../reports/m1-implementation-notes.md))
found that with the approved `CODEX_HOME = <cwd>/.codex` on the geesefs durable session mount,
codex's SQLite state wedges the turn (`geesefs: *fuseops.CreateLinkOp error: function not
implemented`; SQLite-WAL needs hardlinks/shared memory the S3 FUSE cannot provide). These probes
supply the facts for the new layout decision.

### P8a — a supported state redirect exists

**Verdict: YES.** Codex 0.145 can move its SQLite state out of CODEX_HOME through a dedicated,
supported knob; the journal mode itself is hardcoded WAL.

- Env var: `CODEX_SQLITE_HOME` (`codex-rs/state/src/lib.rs:93`,
  `pub const SQLITE_HOME_ENV: &str = "CODEX_SQLITE_HOME";`), resolved in
  `codex-rs/core/src/config/mod.rs` `resolve_sqlite_home_env` (relative values resolve against
  the session cwd) and consumed as
  `sqlite_home = cfg.sqlite_home ∥ $CODEX_SQLITE_HOME ∥ codex_home` (`mod.rs:3756-3761`).
- Config key: `sqlite_home` (the `Config` struct field documents it: "Directory where Codex
  stores the SQLite state DB", `mod.rs:~893`); `log_dir` similarly moves logs (default
  `$CODEX_HOME/log`).
- **Empirically verified on the daemon path** (`transcripts/p8-combo.jsonl`, `phase1-files`):
  with `CODEX_SQLITE_HOME` set, ALL FOUR SQLite families (`state_5`, `goals_1`, `logs_2`,
  `memories_1`, each with `-wal`/`-shm`) land in the redirect dir; `CODEX_HOME` retains only
  plain files: `auth.json`, `config.toml`, `installation_id`, `sessions/` (thread rollouts,
  jsonl), `shell_snapshots/`, `skills/`, `.tmp/`.
- WAL is hardcoded for every writable codex DB:
  `codex-rs/state/src/sqlite.rs:36-49` `open_read_write_pool` sets
  `.journal_mode(SqliteJournalMode::Wal)` unconditionally. Hence P8d below.

### P8b — resume after daemon death needs the home, but only its plain files

**Verdict: native resume DOES depend on CODEX_HOME content — a per-run ephemeral home silently
loses multi-turn context after daemon eviction. But the dependency is the `sessions/` rollout
files, NOT the SQLite: with the home preserved and a FRESH sqlite dir, native resume works.**

Method (`scripts/p8-resume.mjs`, `scripts/p8-combo.mjs`): teach a session a codeword, destroy
the daemon, start a NEW daemon, seed the persist driver with the synthetic record exactly as the
runner does (`environment.ts` `persist.updateSession` + `resumeSession(localSessionId)`, which
drives the repo patch's `session/load` path in
`patches/sandbox-agent@0.4.2.patch`), then ask for the codeword. "Native load" = the resumed
`agentSessionId` equals the original (the patch falls back to `createRemoteSession` — a fresh
thread — when `session/load` fails, and the runner then flags `loadedFromContinuity=false` and
degrades to cold prompt-replay).

| Phase | CODEX_HOME | sqlite dir | Native load | Codeword retained | Transcript |
|---|---|---|---|---|---|
| resume-1 | same, preserved | in home (default) | **yes** (same id) | **yes** (`FLAMINGO-42`) | `p8-resume.jsonl` phase2 |
| resume-2 | **fresh** (auth.json+config only) | in home (default) | **no** (new id, silent fallback) | **no** ("I don't know") | `p8-resume.jsonl` phase3 |
| combo | same, preserved | **fresh empty** `CODEX_SQLITE_HOME` | **yes** (same id) | **yes** (`OCELOT-77`) | `p8-combo.jsonl` phase2 |

So the resume-critical state is exactly the geesefs-SAFE portion of the home (append-only jsonl
rollouts), and the geesefs-LETHAL portion (SQLite WAL) is exactly what the supported redirect
moves off. Note also the failure mode of an ephemeral home: no error — `session/load` falls back
silently and the model just doesn't know; only the runner's own cold-replay machinery would
paper over it (that is the existing non-native-continuity path, with its token cost and
history-fidelity limits).

### P8c — Claude parity (code reading)

Claude's equivalent state never sits on the geesefs cwd:

- **Local durable runs**: Claude's config dir is the runner container's OWN disk —
  `mount.ts:718`: "Local runs call none of this: `~/.claude` there is the runner container's own
  disk"; the daemon only inherits `CLAUDE_CONFIG_DIR` when the operator sets one
  (`daemon.ts:265-268`). Transcripts survive daemon eviction for the container's lifetime.
- **Daytona runs**: only `~/.claude/projects` — the session transcripts, plain jsonl — is
  geesefs-mounted per session, "explicitly NOT `~/.claude` whole"
  (`mount.ts:161-172 harnessSessionMounts`).
- Claude's native resume (`session/load` with `_meta.claudeCode.options.resume`, patch
  `buildLoadSessionParams`) reads those transcript files. So Claude already relies on
  jsonl-append files on geesefs (Daytona path) — the same write class as codex's `sessions/`
  rollouts — and keeps its SQLite-free state off the mount.

Parity conclusion: a per-run ephemeral codex home would be a **regression** vs Claude (Claude
keeps native resume across daemon eviction on both paths). A cwd home with the sqlite redirected
off-mount is parity-or-better (codex's resume files would be durable even across container
restarts, which local Claude's are not).

### P8d — WAL off on geesefs

Skipped, per the P8a finding: `open_read_write_pool` hardcodes `SqliteJournalMode::Wal`
(`state/src/sqlite.rs:40`); codex exposes no journal-mode knob, so there is nothing supported to
test.

### Recommendation

The facts support **keeping `CODEX_HOME = <cwd>/.codex` on the durable mount and adding
`CODEX_SQLITE_HOME = <per-run ephemeral local dir>` to the codex daemon env** (m1 Option 2, now
proven): it removes exactly the wedging files from geesefs (P8a, all four DB families verified
moved), preserves native `session/load` resume across daemon eviction because resume rides the
rollouts that stay on the durable home (P8b combo), keeps the M3 `config.toml`-via-`harnessFiles`
delivery and the auth.json-on-cwd flow unchanged, and is parity-or-better with Claude (P8c). The
ephemeral-home alternative (m1 Option 1) silently breaks native multi-turn continuity after every
daemon eviction (P8b resume-2) — worse than Claude parity — and should only be a stopgap if
something else on the home turns out to wedge geesefs. Two validation items remain for the real
mount (these probes ran on local dirs): (1) confirm codex's `sessions/` jsonl appends behave on
geesefs — expected safe, it is the same write class Claude's mounted transcripts already use;
(2) watch `CODEX_HOME/.tmp/` and `skills/` — codex performed a git clone under `.tmp/plugins-*`
during session start, and git on geesefs is untested; if it misbehaves, `.tmp` may need its own
off-mount redirect (no supported knob seen — worth checking `codex-rs` for a tmp-dir override
before inventing one).

---

## Surprises worth escalating

1. **The adapter, not codex config, owns the sandbox/approval axis** (P2). `sandbox_mode` in
   `config.toml`/`CODEX_CONFIG` is effectively dead on the daemon path; the ACP `mode` option is
   the real switch and it couples full access with approval-never. This invalidates D-003 as
   written and needs a decision (workspace-write + escalation-prompt HITL vs no-HITL full access).
2. **The d3b poison combo**: `sandbox_mode` inside CODEX_CONFIG next to `approval_policy`
   silently killed all gates. CODEX_CONFIG payloads must be curated key-by-key, never passed
   through from anything user-shaped.
3. **Codex speaks WebSockets first** (P3) — the egress proxy must handle (or fast-reject) the
   upgrade request, which carries the same Authorization header.
4. **`openai_base_url` is project-local-denylisted upstream** (P3) — a workspace repo cannot
   redirect credentials, which retires the credential half of first-spike risk 1.
5. **The auto-login writes whatever it is given** (P3) — good for placeholders, but it means a
   typo'd real key is persisted silently too; failures only surface as 401s at run time.
6. **`agent-full-access` suppresses even explicit per-tool MCP "prompt" config** (P6) — the
   full-access mode is a total gate blackout, not just a shell-approval policy. Any
   HITL-for-tools posture must be enforced runner-side (e.g. in the tool-MCP gateway), not via
   codex config.
7. **Enabling codex's inner sandbox locally costs `SYS_ADMIN` + unconfined seccomp/AppArmor on
   the runner container** (P7) — a weaker outer boundary to gain an inner one, and it does not
   transfer to Daytona. If declined, the local and cloud gate textures at least stay identical.

## Transcript index (this round)

| File | Scenario |
|---|---|
| `p1-two-sessions.jsonl` | one daemon, three sessions, CODEX_CONFIG fixed at daemon start; per-session env override attempt is a dead letter |
| `d1…d5-*.jsonl` | approval matrix, `danger-full-access` in `config.toml` (proves file `sandbox_mode` is overridden by the adapter) |
| `d1b…d5b-*.jsonl` | same matrix, `danger-full-access` via CODEX_CONFIG (proves CODEX_CONFIG `sandbox_mode` is also overridden; d3b = poison combo) |
| `e1…e4-fullaccess-*.jsonl` | real full access via `setConfigOption("mode","agent-full-access")`: zero gates everywhere, untrusted not restorable |
| `p3a/p3b-*.jsonl` | placeholder key against the real API (opaque pass-through, 401 echo, unvalidated auto-login write) |
| `p3a2/p3b2-baseurl.jsonl` + `p3-listener-capture.jsonl` | placeholder key against the local listener via `openai_base_url`: byte-exact Bearer header, `/responses` endpoint, ws-upgrade-then-POST transport |
| `f1…f3-fullaccess-mcp-*.jsonl` | MCP `prompt`/per-tool-`prompt`/`writes` approval config under `agent-full-access`: zero gates |
| `f1c-agentmode-mcp-prompt.jsonl` | control: same `prompt` config under default `agent` mode gates (proves the config is honored when the mode allows asking) |
| `p7-bwrap-matrix.log` | codex `sandbox` bwrap init matrix: host + 8 docker configs on the runner image, plus the enforcement check (produced by `scripts/p7-bwrap-matrix.sh`) |
| `p8-resume.jsonl` | resume after daemon death: same home = native load + codeword retained; fresh home = silent fallback, context lost (`scripts/p8-resume.mjs`) |
| `p8-combo.jsonl` | `CODEX_SQLITE_HOME` redirect: all sqlite moved off home (file inventory), and native resume retains context with a FRESH sqlite dir (`scripts/p8-combo.mjs`) |
