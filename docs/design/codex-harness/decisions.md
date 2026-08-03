# Decision register

## D-009 (PR train) · One PR with inline review comments · approved (Mahmoud, 2026-07-25)

The branch ships as a single PR, not stacked lanes. Reasoning: the split's only
purpose is reviewability; the feature split requires hunk-level file splitting
against already-made commits (the known-painful GitButler case), and the area
split's lanes are not independently meaningful (the wire contract spans SDK and
runner). Requirement carried with the ruling: thorough inline review comments on
files and non-obvious parts, posted with the PR, so the reviewer can navigate.
Execution waits for the Daytona layout ruling (D-002 research in flight).


Every choice in this project that is not an obvious copy of the existing Claude/Pi
pattern is recorded here. A decision has one of three statuses:

- **proposed**: written down, argued, waiting for Mahmoud.
- **approved**: Mahmoud approved it (date noted). Only approved decisions ship.
- **rejected**: Mahmoud rejected it; the entry stays as history with the alternative
  chosen.

Choices that ARE obvious copies of the existing pattern (adapter class shape, settings
file rendering, loopback MCP tool delivery, mount-variable contract, Daytona
subscription rejection) are not registered; they follow the code they mirror.

---

## D-001 (process) · Permanent home of the add-harness playbook · approved (Mahmoud, 2026-07-25: commit to the repo)

Landed as commit `f5302ffe7a` on the worktree branch: gitignore allowlist entry plus
`SKILL.md` and `resources/LESSONS.md`. Rides the docs lane of the lane split.

Mahmoud asked for a living playbook that encodes the learnings from this project so
future harnesses (Hermes, Gemini, OpenCode) get easier, covering implementation, the
process, and the communication rhythm. It now exists as a skill at
`.agents/skills/add-harness/` (SKILL.md plus an append-only `resources/LESSONS.md`),
updated at every milestone close. New folders under `.agents/skills/` are gitignored
by default, so today it lives only in this worktree.

- Option 1 (recommended): commit it to the repo at Milestone 5 with a gitignore
  allowlist entry, like the other tracked skills (`write-docs`, `agent-release-gate`).
  Every agent and contributor gets it in any checkout; the Mahmoud-specific process
  section stays, matching the precedent of `codex-onboarding`. Cost: the process
  section is visible in the public repo.
- Option 2: keep it local-only and copy it to the main checkout's skills folder when
  this worktree is cleaned up. Private, but future agents only find it via memory
  pointers, and other contributors never see it.

Recommendation: Option 1, because the point of the playbook is that the next harness
project finds it without archaeology, and nothing in it is sensitive.

## D-002 (Checkpoint 1) · CODEX_HOME layout per credential mode · managed half approved; subscription direction approved

Rulings (Mahmoud, 2026-07-24):

- **Managed half approved:** `CODEX_HOME = <session cwd>/.codex` as proposed below,
  with one added requirement from the cloud roadmap: the layout must stay compatible
  with the Daytona secret-delivery design (#5223/#5277), where the sandbox holds only
  a placeholder value and Daytona's egress proxy substitutes the real key in flight.
  For Codex that means: in cloud managed mode the runner writes the PLACEHOLDER into
  `auth.json`, never a real key, and codex must copy it unchanged into its request
  headers (the design's "opaque HTTP credential" property). Probe P3 verifies codex
  treats the credential opaquely; the #5223 design already carries the matching
  Daytona-side proof obligation (placeholder substitution for values that did not
  originate from an environment read).
- **Subscription direction approved:** environment channel over file juggling. The
  operator's directory is mounted as `CODEX_HOME` (token refresh writes land in the
  real login, like Claude), and run config is delivered via the `CODEX_CONFIG`
  environment JSON. The symlink assembly is fallback only, kept alive solely in case
  the per-run scoping probe (P1) fails. Process note recorded with this ruling: the
  scoping and refresh facts should have been verified BEFORE the mechanism question
  was ever asked; verification is now running immediately (P1, P4, P5), not parked
  at Milestone 4.

**Amendment (2026-07-24, evidence-forced, P8):** Milestone 1 live QA found the
approved managed layout wedges on durable sessions: codex stores SQLite state (with
write-ahead logging hardcoded) inside `CODEX_HOME`, and the geesefs S3 mount cannot
support it. The repair keeps the approved layout and adds one environment variable:
`CODEX_SQLITE_HOME` (supported upstream, `codex-rs/state/src/lib.rs:93`) points the
SQLite families at a local per-daemon directory off the mount. P8 verified this moves
exactly the wedging files; session resume after daemon replacement rides the plain
`sessions/` rollout files, which stay on the durable home and are the same write
class as Claude's mounted transcripts (parity confirmed in P8c). The ephemeral-home
alternative was rejected because a fresh home silently loses native resume (P8b).
Residual validation riding Milestone 1's re-QA on the real mount: rollout appends on
geesefs, and codex's `.tmp/` git activity on geesefs (no upstream override knob
exists for it).

Probe results (same day, `spike/derisk-findings.md`), all confirming the approved
directions:

- P1/P5: `CODEX_CONFIG` is fixed per daemon process, and that is sufficient, because
  the runner pools whole daemons and evicts to a fresh one whenever the config
  fingerprint or credential epoch changes. Constraint carried into design: everything
  that feeds `CODEX_CONFIG` must be part of the config fingerprint. The poison-combo
  constraint (never `sandbox_mode` inside `CODEX_CONFIG`) is recorded under D-008.
- P3: codex credentials are opaque in the #5223 sense: a placeholder-shaped value
  from `auth.json` reached the wire byte-exact as a bearer header, with no client-side
  format validation. Two caveats for the Daytona integration: codex first attempts a
  WebSocket upgrade with the same header (the egress proxy must substitute or
  fast-reject it), and the base-url override is the config key `openai_base_url`.
  Upstream denylists that key from workspace-local config, which retires the
  credential half of the workspace-config risk (D-007).
- P4: codex rewrites `auth.json` in place (no rename), so the symlink fallback would
  survive token refresh; store mode must be pinned to `file` if that path is ever
  used. With P1 confirming the environment channel, the fallback stays unused.

**Amendment (2026-07-25, Milestone 5, credential-safety-forced) · Daytona managed
home is IN-VM, not the durable cwd · REJECTED by Mahmoud (2026-07-25), superseded
by the research below:**

Mahmoud's ruling and reasoning: sacrificing codex's native resume on Daytona is
optimizing for the wrong thing, because platform-side history replay is a crutch
the product is moving away from, and durable sessions with harness-native
continuity are the direction. His proposed design: keep the durable home (native
rollouts durable, native resume survives sandbox replacement; SQLite stays in-VM,
a hard filesystem constraint), and manage the credential by lifecycle: write
auth.json at session start, delete it from durable storage before the sandbox
stops. He also asked for deeper research on whether codex can take a key with no
credential file at all (the surprise that no file-free path exists).

**Final ruling (Mahmoud, 2026-07-25): FILE-FREE managed auth on the durable home,
both local and Daytona.** The research (`spike/auth-and-cleanup-research.md`)
found codex 0.145 supports a custom model provider with `env_key`: the key is read
from the process environment AT REQUEST TIME, no credential file ever exists, the
built-in provider's hardcoded login requirement is bypassed by design, and the
WebSocket-upgrade caveat disappears (custom providers do not attempt it). Probed
green end to end on the daemon path against both a local listener (placeholder
byte-exact in the header) and the real API. This restores `CODEX_HOME =
<cwd>/.codex` on the durable mount for Daytona (native resume durable, Mahmoud's
requirement), keeps `CODEX_SQLITE_HOME` in-VM (hard geesefs constraint), deletes
both managed auth.json writers and every cleanup backstop (including a discovered
ordering bug where the local backstop ran after the storage unmounted and stranded
the file), and composes exactly with the #5277 placeholder (which lands in the
same process environment `env_key` reads). Subscription mode is unchanged (the
operator's own login file via symlink). The add-then-remove lifecycle stays
documented in the research file as the fallback if a future codex version breaks
the provider mechanism. Process post-mortem for why this was missed for three
milestones: the enumerate-mechanism-space rule, recorded in the add-harness skill
and session memory.

The rejected in-VM amendment text follows for the record:
The managed ruling approved `CODEX_HOME = <cwd>/.codex` plus the requirement that on
Daytona the key be reliably deleted at session end. Milestone 5 implementation found
that requirement is not reliably satisfiable with the key on the durable cwd: on
Daytona the cwd is a geesefs mount of durable S3 storage, and the teardown path pauses
or destroys the sandbox (`environment.ts` destroy: sandbox pause/destroy runs before
any per-run file backstop), so a key written under the durable cwd can outlive the run
in the store, and a paused (parked) sandbox keeps it for reuse. The repair, same class
as the P8 SQLite amendment: for a managed Daytona codex run, put `CODEX_HOME` on an
IN-VM path (`/home/sandbox/agenta/codex-home/<basename(cwd)>`, a sibling of the relay
and tool-MCP dirs) and `CODEX_SQLITE_HOME` on the matching in-VM path. auth.json then
lives only in the sandbox VM and is reaped with it — the strongest form of "reliably
deleted at session end" (the key never touches durable storage at all). An authored
`.codex/config.toml` still applies: `prepareWorkspace` writes it under the cwd and
codex reads it as the workspace config layer (D-007), independent of `CODEX_HOME`.
Trade-off recorded: this deviates from the literal `<cwd>/.codex` managed layout for
Daytona only (local is unchanged), and codex's native `sessions/` rollout is in-VM, so
cross-sandbox-replacement native resume is not durable on Daytona — acceptable because
`harnessSessionMounts` has no codex mapping today (no codex durable session resume on
Daytona exists to lose), and warm-sandbox reconnect preserves the in-VM state within a
conversation. Subscription + Daytona stays rejected. Smallest-safe-version: the
credential is kept off durable storage; if Mahmoud prefers the literal cwd layout, the
alternative is a cwd home plus an early-in-destroy sandbox-API delete that fires only on
true teardown (not park) while the sandbox is still alive — more moving parts for weaker
safety.

**Amendment (2026-07-25, security-forced):** the subscription home is now the
SYMLINK ASSEMBLY, not the whole-directory mount. Milestone 4's leakage check proved
the operator's own `config.toml` leaks into product sessions when the mounted
directory is the home: a personal `[mcp_servers.*]` entry spawned and was called
inside a run, and `CODEX_CONFIG` deep-merges additively, so it can add servers but
never remove the operator's (evidence: `spike/config-leakage-findings.md`). The fix
uses the P4-verified mechanism this register kept alive as fallback: the runner
owns a per-session `CODEX_HOME` (its own config, if any), and only `auth.json` is a
symlink into the operator's mount; refresh writes flow through in place, and the
store mode is pinned to `file` via a single-key `CODEX_CONFIG` (allowed: the
poison-combo constraint bans `sandbox_mode` there, not this key). The
operator-facing contract is unchanged (mount the codex directory, set the env var);
what a product session can see from that directory shrinks to the credential file.

Original analysis (kept for the record):

Codex reads everything from one directory: `$CODEX_HOME` holds `config.toml` (run
configuration we render), `auth.json` (the credential), and codex's own session state.
Claude separates login (mounted directory) from run config (a file in the session
working directory); Codex does not, so the layout is a real decision.

**Managed-key mode (vault key):**

- Option A (recommended): `CODEX_HOME = <session cwd>/.codex`. The SDK renders
  `config.toml` as a harness file at `.codex/config.toml` (the existing blind-writer
  seam, exactly like `.claude/settings.json`); the runner writes `auth.json` into the
  same directory with the pi-assets discipline (0600, create-if-absent,
  delete-only-if-created, and delete `auth.json` at session end). File-by-file:
  `config.toml` from the SDK via harness files; `auth.json` from the runner; state
  files written by codex, left to the session lifecycle.
  Trade-offs: zero new wire machinery; the workspace-layer duplication is harmless
  because the same file is both the primary and the workspace config. Cost: on
  Daytona the cwd is durable storage, so the key file must be reliably deleted at
  session end (the delete-only-if-created pattern covers it), and codex state files
  persist in the session workspace (arguably a feature: codex memory follows the
  session).
- Option B: `CODEX_HOME` = an ephemeral directory outside the cwd (the tool-MCP-dir
  pattern). Cleaner separation, but `config.toml` can no longer ride the harness-file
  seam (paths are cwd-relative and the writer is blind), so it needs either a new
  wire field or runner-side knowledge of codex config, both of which break the
  "adapter renders, runner writes blindly" division.

**Subscription mode (local only, operator's ChatGPT login):**

- Option A (recommended): the operator mounts their codex directory and sets
  `CODEX_HOME` to it, mirroring `CLAUDE_CONFIG_DIR`; codex reads and refreshes
  `auth.json` there directly (refresh keeps working; nothing is copied). Run
  configuration is delivered via `CODEX_CONFIG` (the adapter's environment JSON,
  proven to override file config in both directions) so the operator's own
  `config.toml` in the mount does not leak into runs. One open verification: whether
  the runner can scope that environment variable per run under daemon session
  pooling. If it cannot, the fallback inside this option is workspace-layer files,
  which can only tighten; the registered degradation is that per-tool pre-allow
  (F-046) does not apply on subscription runs, so "allow" tools park like "ask"
  tools.
- Option B: copy `auth.json` from the mount into a per-run home. Full config control,
  but a token refresh during a run lands in the throwaway copy; if the backend
  rotates refresh tokens, the operator's real login silently breaks. Rejected-by-
  default for that corruption risk.

## D-003 (Checkpoint 1) · Default approval policy when the author sets nothing · approved (Mahmoud, 2026-07-24: on-request)

Authors write codex-native `approval_policy` themselves (pass-through, no mapping).
The decision is only the platform default for an unconfigured agent.

- Option A (recommended): `on-request` — codex's own default; commands run, risky
  escalations pause for approval. Closest to the Claude default posture, and the
  park-and-resume flow is fully wired (spike Q1), so pauses surface properly in the
  UI.
- Option B: `untrusted` — every command pauses. Safest, but an unconfigured agent
  becomes unusable in practice (every `ls` parks).
- Option C: `never` — nothing pauses; the Agenta sandbox is the only enforcement.
  Matches the old draft PR's posture; rejected as a default because it silently
  gives up human-in-the-loop.

## D-004 (Checkpoint 1) · sandbox_mode inside our containers · REOPENED (superseded by D-008)

Approved 2026-07-24 (danger-full-access), then reopened the same day: derisk probe P2
(`spike/derisk-findings.md`) proved the approved combination does not exist on the
codex-acp path. The bridge overrides file and environment `sandbox_mode` with its
per-turn ACP mode preset, and the only full-access switch (`mode=agent-full-access`)
hard-couples `approval_policy=never`. Full access and approvals are mutually
exclusive today. The revised decision is D-008.

Codex's own OS-level sandbox (bubblewrap) fails to initialize inside containerized
environments (verified on this host; the same nesting problem is expected inside the
runner's Docker and Daytona sandboxes). Codex still works; it just cannot
self-sandbox, and with the inner sandbox unavailable, `untrusted` runs ask "run
outside the sandbox?" for everything they touch.

- Option A (recommended): default `sandbox_mode = "danger-full-access"` inside
  Agenta sandboxes, with the container or Daytona VM as the enforced boundary. This
  is the same trade-off the Claude harness makes today (Claude has no inner OS
  sandbox either), and Layer-2 reinforcement still maps a read-only filesystem
  boundary to `read-only`. The name is alarming but describes the inner process
  only.
- Option B: keep `workspace-write` and accept "sandbox failed to initialize"
  escalation prompts. More gates, but the gate texts are confusing (they reference a
  sandbox the user never asked for) and the sandbox is not actually enforcing.
- Either way, the approval-policy-times-sandbox-mode interplay gets one verification
  probe at the start of Milestone 3 before the settings renderer hardcodes defaults.

## D-005 · Pin the Codex ACP adapter · approved (Mahmoud, 2026-07-24: pin; pre-install at bootstrap, bake into images at Milestone 5)

The daemon installs `@agentclientprotocol/codex-acp` (which bundles the codex CLI)
from the ACP registry at first use with a floating `^1.1.7` range. The Claude
adapter is pinned in `package.json`; the Codex one would drift under us, and its
version determines protocol behavior (gate shapes, config channels).

- Option A (recommended): pin by pre-installing the adapter directory at a fixed
  version during runner bootstrap (dev) and baking it into the runner/Daytona images
  (Milestone 5), with the version recorded next to the sandbox-agent pin.
- Option B: accept the floating install and re-verify on every release-gate run.
  Cheaper now; every registry release becomes a potential silent breakage.

## D-008 (Checkpoint follow-up) · Runtime mode: how HITL and sandbox trade off · approved (Mahmoud, 2026-07-24: Posture 2, full access + runner-gated tools)

Ruling: default ACP mode is `agent-full-access`; Agenta-tool approvals (allow, ask
with park-and-resume, deny) are enforced runner-side at the `agenta-tools` pause
seam, harness-independent. Authors may override the mode per agent (`agent` mode with
its documented texture caveat). An upstream issue is filed asking codex-acp to
decouple approval policy from the full-access preset. Consequence for Milestone 3:
its scope shifts from codex-side settings rules to the runner-side tool gate;
`codex_settings.py` Layer 3 rendering remains only for authors who choose `agent`
mode.

Context: codex-acp exposes three ACP session modes and sends their approval and
sandbox policies per turn, overriding whatever `config.toml` or `CODEX_CONFIG` say:
`read-only` (on-request approvals, read-only sandbox), `agent` (on-request approvals,
workspace-write sandbox; the default), and `agent-full-access` (approvals NEVER,
sandbox off). Additional verified facts: under `agent` mode, MCP tool gating and
per-server pre-allow work exactly as designed (F-046 intact); codex's own bubblewrap
sandbox fails to initialize in our containerized environments, which makes `agent`
mode approvals noisy and nondeterministic for shell commands (sometimes an approval
prompt phrased as "the sandbox failed, may I rerun?", sometimes the bwrap error
returned as the answer). And a poison combination exists: `sandbox_mode` next to
`approval_policy` inside `CODEX_CONFIG` silently disables all gates; the renderer
must never emit it (standing constraint, already communicated to implementation).

Probe results (P6, P7 in `spike/derisk-findings.md`):

- P6: under `agent-full-access`, NO codex-side configuration restores tool gates
  (per-server prompt, per-tool prompt, and writes modes all ran gateless; the same
  config gates correctly under `agent` mode). If we want tool approvals under full
  access, the runner must enforce them itself: our `agenta-tools` MCP server can
  pause a `tools/call` until a human answers, the same seam client tools already use.
  That enforcement is our code, works for any harness, and needs no codex
  cooperation.
- P7: codex's bundled sandbox CAN initialize inside our runner-image containers, but
  only with `seccomp=unconfined`, `apparmor=unconfined`, and `SYS_ADMIN` plus
  `NET_ADMIN` (or `--privileged`). That weakens the outer container boundary to
  revive an inner one, and Daytona grants none of it. The root cause is Ubuntu
  24.04's restriction on unprivileged user namespaces, so even the bare host fails.

Candidate postures with all facts in:

- Posture 1: default `agent` mode. Approvals work everywhere (shell escalations,
  Agenta tools, pre-allow), at the cost of noisy and nondeterministic shell texture
  while the inner sandbox keeps failing: commands park behind "the sandbox failed,
  may I rerun?" prompts, and sometimes the failure is returned as the answer instead
  of asking.
- Posture 2 (recommended): default `agent-full-access` for shell, with Agenta-tool
  approvals enforced runner-side at the `agenta-tools` pause seam (allow runs, ask
  parks for the UI, deny refuses). Autonomous runs stay clean; tool-level
  human-in-the-loop, the part the product actually promises, is preserved and owned
  by our code. The gap versus Claude: no approval gate on raw shell commands; the
  container or VM boundary is the enforcement there, which is the posture Mahmoud
  already approved in the original D-004. Authors can still opt into `agent` mode
  for gated shell.
- Posture 3: privileged local containers to fix the inner sandbox. Rejected as a
  default: it trades real outer isolation for a nested sandbox, does not transfer to
  Daytona, and turns the security boundary into host-configuration trivia. Possibly
  a documented opt-in for self-hosters later.

Follow-up worth filing either way: an upstream issue against codex-acp asking to
decouple approval policy from the full-access mode preset.

**Amendment (2026-07-24, implementation constraint):** the runner-side ask gate
parks via the COLD-REPLAY pattern, not the keep-alive park. Reason: the
`agenta-tools` seam is a synchronous HTTP `tools/call` with no ACP permission id;
the connection cannot outlive a paused turn. This is the exact pattern client tools
(browser-fulfilled tools) already use in production: the turn pauses, the approval
surfaces in the UI, and on approval the next turn re-issues the call, which the
decision store then executes or refuses. Keep-alive parking still applies to real
ACP permission gates (the authored `agent` mode classification). Consequence: a
Codex ask-tool approval behaves like a client-tool approval, not like a Claude
ask-tool approval (which rides Claude's own ACP gate). Also fixed in the same
round: the mode override travels as a dedicated typed `harnessMode` wire field
(mirroring `model`), not a generic options blob.

**Amendment (2026-07-25, bug-forced):** `codex_settings.py` must NOT render
`[mcp_servers.*]` tables for servers delivered over the ACP session channel. Codex
validates every config-file server entry for a transport and kills the session when
one is missing, which broke every tool run (root cause of the "deployment
regression" misdiagnosis; evidence in `reports/m3-implementation-notes.md`). Since
the runner-side gate is the permission authority under this ruling, the per-server
approval tables are dropped from the rendered config entirely. Consequence,
confined to the opt-in `agent` mode: pre-allow cannot be expressed to codex there,
so allow-tools pause at codex's own gate like ask-tools. Layers 1/2 scalar
rendering is unaffected.

**Amendment (2026-07-31, approved by Mahmoud on PR #5509) · patch codex-acp so
full access keeps its native approvals · SUPERSEDES the cold-replay amendment
above.**

Ruling: patch `@agentclientprotocol/codex-acp` at the image pin step so the
`agent-full-access` preset sends `approvalPolicy: "on-request"` instead of `"never"`,
leaving its `dangerFullAccess` sandbox policy untouched. Codex approvals then park
WARM on the runner's existing keep-alive path, the same machinery Claude uses, and
the human answers before the tool call is issued.

Why the cold-replay posture was not acceptable: cold approval behavior differs
materially from warm. The turn dies, the user approves, and the model re-issues the
call on a follow-up turn, so the decision lands after the fact instead of in place.
That difference belonged in the PR description and was buried in milestone notes.

Research answering "why can't we do this, and why does Zed manage it" (codex-acp at
our 1.1.7 pin, codex rust-v0.145.0, Zed's approval flow):

- The coupling is not in the ACP protocol and not in codex. Codex core takes approval
  policy and sandbox policy as two independent per-turn parameters. codex-acp's
  full-access preset hardcodes `approvalPolicy: "never"` next to the unsandboxed
  policy (`src/AgentMode.ts`) and re-sends both on every turn
  (`src/CodexAcpClient.ts`), overriding any config. Under `never`, codex
  auto-approves every gate, so no permission request ever reaches the runner.
- Zed runs the default `agent` mode, so approvals are `on-request` and the turn
  blocks in place. Zed can afford `agent` mode because on a desktop codex's inner OS
  sandbox initializes; in our containers bubblewrap cannot (probe P7), which is why
  we need full access, and full access is what turned approvals off.
- Not a version problem: codex-acp HEAD is byte-identical to 1.1.7 in the relevant
  files. The upstream decoupling ask (agentclientprotocol/codex-acp#310) is open with
  no assignee.
- Shell stays gate-free under the patch: codex only raises exec approval when the
  filesystem sandbox is restricted, which full access is not. MCP (Agenta) tool calls
  raise native gates, which the runner already classifies (`codex-acp-permission`).

Consequences:

- The runner-side seam gate (`executable-tools.ts`) is no longer the sole authority;
  it becomes second-line enforcement. To keep one approval from prompting the human
  twice, a Claude/Codex gate that resolves to allow for a runner-executed tool
  records an execution grant, and the seam consumes it. No grant means no prior
  approval, so the seam still parks — fail closed.
- Rejected alternatives: (a) hold the loopback `tools/call` open for a warm park at
  the MCP seam — harness-independent and better reject UX, but a bigger runner change
  with a 300-second `tool_timeout_sec` race; kept as a roadmap item. (b) default
  `agent` mode — warm today, unacceptable shell noise in containers. (d) wait for
  upstream — not a plan on its own.
- The patch retires itself: file the same change upstream, and drop the patch when an
  accepted release ships. `applyCodexAcpApprovalPatch` reports `already-patched` for a
  source that already sends `on-request`, and the image build fails loudly if the
  preset drifts.

## D-006 (informational) · Model catalog entries · no ruling needed

Curated catalog: gpt-5.6-sol (default), gpt-5.6-terra, gpt-5.6-luna (cheapest, used
for probes), gpt-5.5, gpt-5.2. The gpt-5.1-codex ids are listed by the API but
rejected by the backend as deprecated, and the daemon's embedded default
(gpt-5.3-codex) is from the same deprecated family, so the runner always passes the
model explicitly. Maintained via the sync-model-catalog skill; recorded here only
because the stale-model failure mode already bit the old draft PR.

## D-007 (informational, GA follow-up) · Workspace config files influence codex · no ruling needed now

Codex 0.145 reads `<cwd>/.codex/config.toml` and bare `<cwd>/config.toml` as
additional config layers. Verified: they can tighten gating; loosening is ignored. A
user repository containing a stray `config.toml` (many repos have one for other
tools) silently becomes codex configuration. Accepted for v1 with documentation;
before GA, map which keys the workspace layer can set (MCP servers? model?) and
decide whether the runner should neutralize it.
