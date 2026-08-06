# Codex auth-and-cleanup research — file-free credentials and the durable-home lifecycle

Date: 2026-07-25. Follow-up to [findings.md](findings.md) and [derisk-findings.md](derisk-findings.md),
commissioned by the D-002 M5-amendment rejection (decisions.md): Mahmoud wants the durable
`CODEX_HOME = <cwd>/.codex` back on Daytona, and asked (1) whether codex can take an API credential
with NO auth.json at all, and (2) how an add-then-remove auth.json lifecycle would land in the
runner's teardown paths.

Method: same as the earlier spikes — real `sandbox-agent` daemon from `services/runner/node_modules`,
`SandboxAgent.start(local({env}))` → `createSession({agent:"codex"})` → `prompt`, driver
[`scripts/drive.mjs`](scripts/drive.mjs), model `gpt-5.6-luna`, local listener
[`scripts/p3-listener.mjs`](scripts/p3-listener.mjs) standing in for the API where tokens were not
needed. Source citations: `openai/codex` @ tag `rust-v0.145.0` and the installed adapter bundle
`@agentclientprotocol/codex-acp` 1.1.7 (`~/.local/share/sandbox-agent/bin/agent_processes/codex/`).
Scenario inputs (keys redacted) in [`scenarios-auth/`](scenarios-auth/), raw transcripts in
[`transcripts/`](transcripts/) (`q1a*`, `q1b`, `q1c`, `q1-listener-capture`).

## Headline

**Question 1: YES — three distinct file-free mechanisms exist, and two were proven green
end-to-end on the daemon path.** The strongest is a custom `model_providers` entry with
`env_key = "OPENAI_API_KEY"`: codex then reads the key from process env AT REQUEST TIME, never
requires a login, never writes auth.json, and (a bonus) skips the WebSocket-upgrade dance. The
first spike's "env var alone does not work" finding (s1) was about the BUILT-IN openai provider,
which hard-requires the auth.json/login flow; a custom provider does not.

**Question 2: the add-then-remove lifecycle is implementable at one seam (`environment.destroy`),
but it has an irreducible crash window, needs a delete-while-mounted ordering fix (the current
backstop delete is ordered AFTER the unmount and is a no-op into the store on local durable runs),
and the whole problem evaporates under the Question-1 mechanism** — with no key file, there is
nothing to add or remove.

Recommendation (bottom): durable home + file-free auth (layout 3) dominates; add/remove (layout 2)
is the fallback if a blocker appears in productizing 3; in-VM home (layout 1, the current branch
state) survives only as the conservative stopgap.

---

## Question 1 — every credential-provision mechanism in codex 0.145 / codex-acp 1.1.7

### Verdict table

| # | Mechanism | Key file on disk? | Daemon path | Evidence | Caveats |
|---|---|---|---|---|---|
| 1 | Pre-seeded `auth.json` in CODEX_HOME (current managed implementation) | **YES** (plaintext, 0600) | works | s2 (first spike) | the mechanism this research replaces |
| 2 | `DEFAULT_AUTH_REQUEST='{"methodId":"api-key"}'` auto-login, default store (`file`) | **YES** (codex writes it) | works | s3 (first spike) | write is unvalidated (P3); file identical to #1 |
| 3 | **Custom provider `env_key`**: `[model_providers.<id>] env_key = "OPENAI_API_KEY"` + `model_provider = "<id>"` in the CODEX_HOME `config.toml` | **NO — never, by construction** | **works, PROBED** | `q1a-envkey-listener.jsonl` (header byte-exact, no auth.json created), `q1a2-envkey-realapi.jsonl` (real API, reply `FILEFREE-OK`, no auth.json) | config.toml carries only the env var NAME (secretless); must be a NEW provider id — built-ins are not overridable; `requires_openai_auth` defaults false so no login gate; env read at REQUEST time |
| 4 | `cli_auth_credentials_store = "ephemeral"` + `DEFAULT_AUTH_REQUEST` api-key auto-login | **NO** (in-memory per process) | **works, PROBED** | `q1b-ephemeral-autologin.jsonl` (reply `EPHEMERAL-OK`, no auth.json) | keeps the BUILT-IN openai provider (full first-party behavior incl. ws transport); login re-runs automatically per daemon process (adapter `checkAuthorization` on every session new/load/resume) |
| 5 | Gateway auth method: `DEFAULT_AUTH_REQUEST='{"methodId":"gateway","_meta":{"gateway":{"baseUrl":…,"headers":{"Authorization":"Bearer …"}}}}'` | **NO** (env JSON → adapter memory → thread config) | **works, PROBED** | `q1c-gateway-listener.jsonl` + `q1-listener-capture.jsonl` (header `Bearer dtn_gateway_placeholder_q1c` on `/v1/responses`) | key is a LITERAL header value in the env JSON (no request-time env indirection); base_url must be explicit; injects a thread-level `custom-gateway` provider (adapter bundle 26176-26214, 26849) |
| 6 | `cli_auth_credentials_store = "keyring"` | no plaintext auth.json (keyring deletes it after save) | possible in principle, NOT probed | source: `login/src/auth/storage.rs` (keyring backends), `keyring-store/Cargo.toml` (Linux backends: keyutils / Secret Service D-Bus) | headless container has no Secret Service; providing one means running D-Bus + a keyring daemon per sandbox with an unlock password, which itself persists an encrypted blob on disk. Strictly dominated by #4; `"auto"` falls back to file (= #1/#2) |
| 7 | `CODEX_API_KEY` env read directly by the auth manager | no | **DEAD on daemon path** | source: precedence head of `load_auth` (`login/src/auth/manager.rs:1215,1226`) is gated on `enable_codex_api_key_env`, and the app-server constructs its AuthManager with it FALSE (`app-server/src/lib.rs:508,717`); only the CLI (`codex exec` etc.) passes true | explains first-spike s1; do not build on it |
| 8 | `CODEX_ACCESS_TOKEN` env (personal access token / agent-identity JWT) | no | honored (unconditional in `load_auth`, manager.rs:1254) | source-cited only | ChatGPT-side token classes, not API keys; irrelevant to managed-key mode |
| 9 | `experimental_bearer_token` provider config key | no IF delivered via `CODEX_CONFIG` env JSON; YES if written into config.toml | honored at request time (`model-provider/src/auth.rs:267-281`) | source-cited only | the literal token would sit in the daemon env / thread config; #3 keeps the secret in exactly one place (the env var) and is strictly cleaner |
| 10 | Provider `auth` command-backed bearer (`ModelProviderAuthInfo`) | no | honored (`auth_manager_for_provider`, `model-provider/src/auth.rs:169-177`) | source-cited only | codex shells out to mint the token; overkill for a static key |
| 11 | `codex login --with-api-key` (stdin, non-interactive) | YES via default store; with `ephemeral` the credential dies with the login process | not useful | `cli/src/login.rs:198-266` + store modes | login CLI is a separate process from the daemon's app-server, so ephemeral cannot carry across; file mode = #1 |
| 12 | `preferred_auth_method` / `forced_login_method` config | n/a | n/a | `config/src/config_toml.rs:252` | constrains WHICH login is allowed (`chatgpt` forbids api-key login); a policy knob, not a provisioning channel |
| 13 | `openai_api_key` config key | — | does not exist in 0.145 | grep of `config_toml.rs` / `core/src/config/mod.rs` | — |

### Why the built-in provider gates and a custom one does not (source map)

- The built-in `openai` provider is created with `requires_openai_auth: true` and `env_key: None`
  (`model-provider-info/src/lib.rs:326-370 create_openai_provider`), and user config CANNOT
  override built-in ids: `merge_configured_model_providers` inserts configured entries with
  `entry(key).or_insert(provider)` (`lib.rs:498`) — only NEW ids land. Hence s1's failure: with the
  built-in provider and no stored auth, the adapter's `authRequired()` → true → ACP -32000.
- `authRequired()` in codex-acp is `response.requiresOpenaiAuth && !response.account` over
  app-server `account/read` (bundle 26164-26170; `checkAuthorization` at 28548 runs on every
  session new/load/resume). `account/read` computes `requires_openai_auth` from the ACTIVE model
  provider in the app-server's own config (`app-server/src/request_processors/account_processor.rs:930-935,
  995-1013`) — which is `CODEX_HOME/config.toml`, NOT the thread config. **Therefore
  `model_provider = "<custom-id>"` must be in the rendered config.toml** (delivering the provider
  tables only through `CODEX_CONFIG` leaves account/read looking at the built-in provider and the
  gate stays). `ModelProviderInfo.requires_openai_auth` defaults to false for custom entries
  (`model-provider-info/src/lib.rs:132-137`), so the gate vanishes.
- Request-time precedence: `resolve_provider_auth` (`model-provider/src/auth.rs:179-197`) checks
  `bearer_auth_for_provider` FIRST — `provider.api_key()` reads the `env_key` env var at call time
  (`model-provider-info/src/lib.rs:283-300`, plain `std::env::var`) and wins over any
  auth.json/ChatGPT auth. So even a stray auth.json would be ignored for a `env_key` provider.
- Custom providers default `supports_websockets: false`, and the probes confirm: **zero WebSocket
  upgrade attempts, plain HTTP POST to `<base_url>/responses` from the first request**
  (`q1-listener-capture.jsonl`; contrast P3's ~7-retry ws dance on the built-in provider). One less
  egress-proxy caveat.
- Model catalog, session modes, reasoning-effort options, and usage accounting are IDENTICAL under
  the custom provider (same 5-model list served, `set-model` accepted; `usage` fully populated in
  `q1a2` — compare s2/s3). The only observable delta: `account/read` reports no account (nothing in
  the runner consumes it), and name-gated OpenAI extras (`is_openai()` string-compares the display
  name, `lib.rs:389-391`) such as remote compaction are off unless the provider is named `OpenAI`.

### Daytona placeholder composability (#5277)

Mechanism #3 is the best possible fit for the placeholder design: the key exists ONLY as a process
environment value read at request time — and the sandbox's env is exactly where a Daytona Secret
placeholder materializes. The runner already puts the resolved key into the daemon env for managed
runs (`plan.secrets` → `buildDaemonEnv`), so no new plumbing: under #5277 the env var holds
`dtn_…placeholder…`, codex copies it verbatim into `Authorization: Bearer` (re-proven byte-exact in
`q1a`, same result as P3), and the egress proxy substitutes. Mechanisms #4 and #5 also compose (the
value they capture is whatever the env held), but they snapshot the value at login/daemon-start
rather than reading per request. Bonus for the proxy: no WebSocket upgrade to handle under #3.

Subscription mode is untouched by all of this: ChatGPT OAuth still needs the token file, and the
approved symlink-assembly design stays as is.

---

## Question 2 — the add-then-remove lifecycle on durable storage

Context recap: Mahmoud's proposed layout for managed Daytona codex is
`CODEX_HOME = <cwd>/.codex` on the durable geesefs mount (native `sessions/` rollouts durable ⇒
native resume survives sandbox replacement, per P8b), `CODEX_SQLITE_HOME` in-VM (hard geesefs
constraint, P8a), auth.json written at session start and DELETED from the durable mount before the
sandbox is paused or destroyed.

### a. Where the delete goes — one seam covers every orderly path

All sandbox lifecycle exits flow through the single idempotent
`environment.destroy` closure (`services/runner/src/engines/sandbox_agent/environment.ts:291-380`);
`pauseSandbox` is invoked NOWHERE else (only environment.ts:315). Current order inside destroy:

1. tool relay / MCP shutdown; graceful ACP `destroySession` (line 304) — after this codex is dead
   and cannot rewrite auth.json;
2. `teardownDisposition(reason)` (line 306): park reasons (`clean-resumable`, `idle-expiry`,
   `capacity-eviction`, `shutdown-idle` — `teardown.ts:24-37`) → `pauseSandbox()` (315); everything
   else (`kill`, `failed-turn`, `aborted`, `compatibility-mismatch`, `shutdown-in-flight`) →
   `destroySandbox()` (324);
3. durable-cwd unmount (329-334), workspace cleanup, then the file backstops INCLUDING today's
   `rmSync(environment.codexAuthFilePath)` (371-372).

**The delete-before-pause/destroy step belongs between (1) and (2)**: after `destroySession`
(writer dead), before `pauseSandbox`/`destroySandbox` (the sandbox and its in-VM geesefs mount are
still alive, so a delete through the sandbox FS API — `deleteFsEntry`, available on the sandbox
handle, `sandbox-agent/dist/index.d.ts:3251` — propagates to S3). Because every reason routes here,
one insertion covers: turn end that parks (server.ts `parkFreshOrDestroy`/`reparkOrEvict` → pool →
`teardown(reason)` → destroy), pool idle TTL expiry (`session-pool.ts:249`), capacity eviction
(`session-pool.ts:348-352`), explicit stop/shutdown (`destroyInFlightSandboxes`, environment.ts:158,
drains the tracked set — parked-live environments are still in `inFlightSandboxes` because only
destroy removes them), cold-replay approval pauses (stopReason `paused` → `failed-turn` → delete),
and aborts.

Two subtleties, both real:

- **Keep-alive pool parking is NOT a teardown.** A pool-parked environment (state `idle`) keeps the
  daemon and sandbox fully alive and auth.json must remain in place for the next warm turn. The
  delete point is exclusively `environment.destroy`; nothing at `pool.park` time.
- **Found gap in the CURRENT code (applies today to local durable managed codex):** the existing
  backstop `rmSync(codexAuthFilePath)` at environment.ts:371 runs AFTER `unmountStorage`
  (329-334). On a local durable session the path then points into the unmounted (empty) mountpoint,
  so the rm is a silent no-op against the host dir and **the key file persists in the durable
  store**. The proposal's delete must sit before the unmount for local (host-side rm through the
  live FUSE mount) and before pause/destroy for Daytona (sandbox-API delete through the live VM).
  Same fix class for both.

### b. Crash window

If the runner process dies without running destroy (SIGKILL, OOM, host loss), nothing deletes the
durable file: **auth.json remains in S3 indefinitely**, attached to a conversation workspace that
may never be resumed. Add-on-start only refreshes/overwrites it when the SAME session runs again;
an abandoned session's key has no reaper. Existing/planned machinery:

- The in-flight drain (`destroyInFlightSandboxes`, environment.ts:142-171) covers orderly SIGTERM
  shutdown only — it is a signal handler in the same process, useless against a hard crash.
- **#5278 (durable managed-resource reconciliation) is the designated sweeper but is a PLAN, not
  code**: an OPEN docs-only PR proposing a reusable `managed_resources` domain (product-owned
  intent, desired/observed state, generation-fenced worker claims, typed provider controllers;
  Daytona Secrets as the first controller). Implementation is explicitly paused pending domain and
  workload-auth decisions. A "durable auth.json object" would be a trivial additional controller
  (desired state: absent unless a live run holds the session) — but none of it exists today.
- Without #5278, the honest statement is: the crash window is bounded only by the durable store's
  own data lifecycle (today: unbounded).

### c. Warm-pause and resume re-preparation

The pause-for-reuse flow is: pool evicts (TTL/capacity/shutdown-idle) → `destroy(reason)` →
disposition `stop` → `pauseSandbox` → sandbox parked warm. The NEXT turn takes the cold path
(`coldAndPark` → `acquireEnvironment`), which reads the stored sandbox pointer and RECONNECTS the
paused sandbox (environment.ts:631-689, `sandbox-reconnect.ts`) — and then runs the same
preparation as a fresh acquire. So **add-on-start covers the resume by construction**, with one
ordering requirement: under the durable-home layout the Daytona auth write must move from its
current pre-mount position (environment.ts:739, fine for the in-VM home) to the post-mount position
the local write already occupies (environment.ts:876-885, "write AFTER the durable cwd mount —
doing it before would be shadowed"), and target `<cwd>/.codex/auth.json` through the sandbox FS
API. The write must also become overwrite-always (the M5 Daytona writer already is; the local
`writeCodexManagedAuthFile` is create-if-absent and would need to refresh a stale key,
`codex-assets.ts`). One residual mismatch to close in implementation: delete-on-destroy +
create-only-if-absent would otherwise ping-pong `authFilePath` bookkeeping — under add/remove the
runner owns the file unconditionally, so delete-only-if-created (designed to protect a
pre-existing operator login) is moot for the managed cwd home.

### d. Severity framing

- **Under #5277 placeholders**: the durable file would hold `dtn_…placeholder…` — a value that is
  only meaningful to that sandbox's egress proxy. A crash-window leak is cosmetic (a worthless
  string in the customer's own workspace store). The add/remove lifecycle then buys tidiness, not
  security.
- **Under today's real-key mode**: the durable file holds the REAL provider key in S3. The
  crash-window leak is a live credential at rest in the conversation workspace, readable by
  anything that later mounts the session cwd (including the user's own future runs listing
  `.codex/`), for an unbounded time absent #5278. Note the intra-run exposure is identical in every
  layout — codex itself, and therefore the agent, can always read its own credential while running
  (P3's opaque pass-through is the same file/env value); the layouts differ only in what persists
  AFTER the run.

### Empirical resume fact (re-confirmed from P8, not re-run)

Durable home + in-VM sqlite ⇒ durable native resume by construction: P8-combo
(`transcripts/p8-combo.jsonl`) already proved the exact shape — daemon destroyed, NEW daemon,
preserved home, **fresh empty `CODEX_SQLITE_HOME`** → `session/load` returned the SAME agent
session id and the codeword was retained. The resume dependency is exclusively the plain-file
portion of the home (`sessions/` rollouts + config/`installation_id`), all of which live on the
durable mount in the proposed layout; nothing else in-VM is consulted (the in-VM side holds only
the redirected SQLite, which P8-combo supplied fresh). Residual, unchanged from D-002's amendment:
these probes ran on local dirs — rollout jsonl appends on REAL geesefs (same write class as
Claude's mounted transcripts) and codex's `.tmp/` git activity on geesefs remain the two
validation items for the first durable-mount QA.

---

## Recommendation — three layouts for Daytona managed mode

| Layout | Native resume durable? | Key at rest in S3? | Crash window? | Moving parts |
|---|---|---|---|---|
| 1. In-VM home (current branch, M5) | no (rollouts die with the VM) | never | none | none (status quo) |
| 2. Durable home + add/remove auth.json | **yes** | transient (run lifetime) | **yes — real key until #5278 exists** | delete-before-pause insertion + write reordering + overwrite-always + eventual #5278 controller |
| 3. Durable home + file-free auth (`env_key` custom provider) | **yes** | **never (no file exists)** | none for credentials | config.toml gains 4 secretless lines; drop both auth writers + the backstop |

- **Layout 3 wins and should be the ruling.** It is the only option that delivers BOTH halves of
  Mahmoud's direction — durable native resume AND no key file ever — and it deletes machinery
  instead of adding it (no auth writers, no symlink-vs-file split for managed mode, no teardown
  backstop, no #5278 dependency for credentials). It composes best with #5277 (request-time env
  read = placeholder lands exactly where the design puts it) and removes the ws-upgrade caveat for
  the egress proxy. What would defeat it: a productization blocker not seen in the probes — the
  known checks to run when implementing are a warm-reuse turn, a native resume after daemon
  replacement under the custom provider (expected fine: `getResumeModelProvider()` reads the
  config's `model_provider`), and the release-gate X1 journeys. The probes covered session
  creation, real-API completion, usage accounting, model selection, and header byte-exactness.
- **Layout 2 is the fallback**, acceptable only with eyes open: an irreducible real-key crash
  window until the #5278 plan ships a sweeper, plus the ordering fixes in (a)/(c). It would win
  only if layout 3 hit a hard blocker AND durable resume stayed non-negotiable.
- **Layout 1 wins nothing long-term**; it is the smallest-safe stopgap already on the branch and
  survives only until the layout-3 change lands. Its "no codex durable resume exists today to
  lose" justification is exactly the crutch-shaped reasoning Mahmoud rejected.

Also recommended regardless of layout: apply the same `env_key` mechanism to LOCAL managed codex
(one code path for both providers, and it retires the pre-existing local-durable backstop-ordering
gap found in (a) by removing the file the backstop was for). Subscription mode keeps the approved
symlink assembly unchanged.

## Transcript index (this round)

| File | Scenario |
|---|---|
| `q1a-envkey-listener.jsonl` | custom provider `env_key`, placeholder value, local listener: session created with NO auth.json and no DEFAULT_AUTH_REQUEST; 6 plain POSTs to `/v1/responses`, `Bearer dtn_secret_placeholder_q1a` byte-exact, zero ws upgrades |
| `q1a2-envkey-realapi.jsonl` | same mechanism against the real API: reply `FILEFREE-OK`, usage populated, home contains no auth.json after the run |
| `q1b-ephemeral-autologin.jsonl` | `cli_auth_credentials_store = "ephemeral"` + api-key auto-login: reply `EPHEMERAL-OK`, no auth.json ever written |
| `q1c-gateway-listener.jsonl` | `DEFAULT_AUTH_REQUEST` methodId `gateway` with a literal Authorization header: requests reached `/v1/responses` with `Bearer dtn_gateway_placeholder_q1c`, no auth.json |
| `q1-listener-capture.jsonl` | raw listener log; first 6 requests = q1a, last 6 = q1c (one listener process served both) |
| `scenarios-auth/` | scenario JSONs (keys redacted) + the three probe `config.toml`s |
