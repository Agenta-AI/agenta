# Codex harness spike — empirical findings

Date: 2026-07-24. Throwaway spike; nothing here is production code.

Every scenario below was driven through the **real daemon path**, exactly as the runner does it:
`SandboxAgent.start({ sandbox: local({ env }) })` → `createSession({ agent: "codex", cwd, sessionInit })` →
`session.prompt(...)`, using the same pinned+patched `sandbox-agent@0.4.2` from
`services/runner/node_modules`. Two small probes used the codex CLI directly and are labeled as such
(they only checked config-file parsing, not behavior). Driver: [`scripts/drive.mjs`](scripts/drive.mjs);
raw per-scenario transcripts (every ACP envelope + permission frame, JSONL) are in
[`transcripts/`](transcripts/). API keys are redacted in transcripts.

## Versions used

| Component | Version | Notes |
|---|---|---|
| `sandbox-agent` (npm SDK + daemon CLI) | 0.4.2 + repo patch | daemon binary from `@sandbox-agent/cli-linux-x64` |
| codex ACP adapter | `@agentclientprotocol/codex-acp` **1.1.7** | NOT `@zed-industries/codex-acp` — the ACP registry (`cdn.agentclientprotocol.com/registry/v1`) now serves this package; the daemon npm-installs it into `~/.local/share/sandbox-agent/bin/agent_processes/codex/` on first `createSession({agent:"codex"})` |
| codex CLI | 0.145.0 | **bundled inside codex-acp** as its npm dep `@openai/codex@^0.145.0`; the natively-installed codex (GitHub releases download, also 0.145.0 on this host) is installed by the daemon but NOT what the adapter spawns unless `CODEX_PATH` is set |
| Default model | `gpt-5.6-sol` | session model list: gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna (cheap) / gpt-5.5 / gpt-5.2. `gpt-5.1-codex*` are API-listed but the backend rejects them as deprecated (`The model \`gpt-5.1-codex\` has been deprecated` streamed as an error update; observed in the first two s2 runs, later overwritten by the passing rerun) |

Process chain: daemon (Rust) → spawns launcher script `codex-acp` → node `codex-acp` bundle → spawns
`codex app-server` (JSON-RPC over stdio) with **inherited env**.

---

## Q1 — Approvals: does codex-acp raise ACP permission requests?

**Verdict: WORKS.** codex-acp raises standard ACP `session/request_permission` reverse-RPCs; the daemon
surfaces them on the same `onPermissionRequest` channel the runner already consumes for Claude, and
`respondPermission(id, "once" | "always" | "reject")` resolves them (allow → command runs, reject →
`tool_call_update status:"failed"` and the turn continues).

Behavior by `approval_policy` (set in the session's `config.toml`), all with `sandbox_mode = "workspace-write"`:

| Policy | Trigger | Result | Transcript |
|---|---|---|---|
| `untrusted` | `echo …` (any non-trusted command) | permission request fired; `once` → ran, output returned | `s4-untrusted-once.jsonl` |
| `on-request` | write a file outside the workspace | permission request fired (escalation); `once` → file created | `s5-onrequest-outside.jsonl` |
| `on-failure` | same outside write | permission request fired after the sandboxed attempt failed; `once` → file created | `s6-onfailure-outside.jsonl` |
| `never` | same outside write | **no** permission request; sandbox blocked the write, model reported failure | `s7-never-outside.jsonl` |
| `on-request` + reject | outside write, reply `reject` | request fired, reject delivered → `tool_call_update status:"failed"`, file NOT created, model said "DENIED" | `s8b-reject.jsonl` |

### Exact frame shape (exec approval)

The daemon-SDK `SessionPermissionRequest` for a shell-command gate (trimmed from `s4`):

```json
{
  "id": "47b5eb97-…", "sessionId": "…", "agentSessionId": "…",
  "availableReplies": ["once", "always", "reject"],
  "options": [
    {"optionId": "allow_once",   "name": "Allow Once",        "kind": "allow_once"},
    {"optionId": "allow_always", "name": "Allow for Session", "kind": "allow_always"},
    {"optionId": "accept_execpolicy_amendment",
     "name": "Allow Commands Starting With `echo spike-approval-test`", "kind": "allow_always"},
    {"optionId": "reject_once",  "name": "Reject",            "kind": "reject_once"}
  ],
  "toolCall": {
    "kind": "execute",
    "rawInput": {"command": "echo spike-approval-test", "cwd": "<workspace>"},
    "status": "pending",
    "toolCallId": "exec-75abb1a5-…"
  },
  "rawRequest": {
    "_meta": {"codex": {"params": {
      "availableDecisions": ["accept", {"acceptWithExecpolicyAmendment": {"execpolicy_amendment": ["echo", "spike-approval-test"]}}, "cancel"],
      "command": "/bin/bash -lc 'echo spike-approval-test'",
      "cwd": "…", "itemId": "exec-75abb1a5-…",
      "proposedExecpolicyAmendment": ["echo", "spike-approval-test"],
      "reason": "Allow running the requested … command outside the sandbox because the sandbox failed to initialize?",
      "threadId": "…", "turnId": "…"
    }}},
    "options": ["…same options, each with _meta.codex.decision: accept | acceptForSession | acceptWithExecpolicyAmendment | cancel"]
  }
}
```

### What this means for `acp-interactions.ts` (vs the Claude classification)

`buildGateDescriptor` anchors on `recordedToolName(tool_call event) → toolCall.name → toolCall.title →
toolCall.kind`, plus `rawInput`. Differences to plan for:

- **Exec gates**: the permission frame's `toolCall` has NO `name`/`title` — only `kind: "execute"` +
  `rawInput{command, cwd}`. The matching `session/update tool_call` event DOES carry
  `title: "<command>"` and the same `toolCallId`, so `recordedToolName` resolves to the command string,
  not a stable rule name. A codex branch should key on `kind: "execute"` + the command, like Claude's
  `Bash` gate.
- **MCP gates**: the permission frame's `toolCall` is nearly empty (`kind: "execute"`, `toolCallId`,
  `status` — **no rawInput at all**); identity and args must be recovered from the earlier `tool_call`
  event by `toolCallId` (`title: "mcp.spike.spike_echo"`, `rawInput: {server, tool, arguments}`). The
  frame carries a top-level marker `"_meta": {"is_mcp_tool_approval": true}`. Note the naming convention
  is **`mcp.<server>.<tool>` with dots**, not Claude's `mcp__<server>__<tool>` — `bareToolName`/
  `serverPermissionFor` will not match without a codex mapping.
- **Option ids differ per gate type**: exec = `allow_once / allow_always / accept_execpolicy_amendment /
  reject_once`; MCP = `allow_once / allow_session / allow_always / decline`. The SDK maps
  `reply: "always"` to the FIRST `allow_always`-kind option (verified in `permissionReplyToResponse` in
  the SDK bundle) — for exec that's session-scoped "Allow for Session" (good: never the execpolicy
  amendment), for MCP it's `allow_session` (also session-scoped, never the persistent "Don't Ask
  Again"). `rawRespondPermission` exists if the runner ever wants to pick a specific optionId.

---

## Q2 — Config: per-session config.toml, CODEX_HOME, env passthrough

**Verdict: WORKS.** A throwaway `CODEX_HOME` per session is fully viable, and env vars pass through the
whole chain untouched.

- **Env passthrough**: env passed to `local({ env })` reaches the daemon (`{...process.env, ...env}`),
  which spawns codex-acp with its own env, which spawns `codex app-server` with inherited env. Proven
  end-to-end: `CODEX_HOME` pointing at a throwaway dir was honored in every scenario (auth.json read
  from there — `s2`; config.toml policy applied — `s4…s7`; codex wrote its state sqlite files there).
- **config.toml location**: `$CODEX_HOME/config.toml` is the primary file. **Codex 0.145 ALSO reads
  project-level config from the workspace** — both `<cwd>/.codex/config.toml` and bare
  `<cwd>/config.toml` were honored (`s12b`, `s12c` vs control `s12d`): a project file with
  `approval_policy = "untrusted"` re-enabled gates that the global `never` had disabled. Direction
  matters: a project file could **tighten** but could NOT **loosen** (`s12e`: global `untrusted` +
  project `never`+`danger-full-access` → the gate still fired). See risks.
- **Auth/config separation**: yes — config can come from `CODEX_HOME/config.toml` while auth comes from
  the `OPENAI_API_KEY` env var alone, IF the adapter is told to auto-login (see Q4a: `DEFAULT_AUTH_REQUEST`).
  Without that, an `auth.json` must sit in `CODEX_HOME`.
- **Two extra per-session config channels** (adapter env vars read by codex-acp 1.1.7, all passthrough
  from the daemon env): `CODEX_CONFIG` — a JSON object merged into the thread config on every
  `session/new` (proven: `CODEX_CONFIG='{"approval_policy":"untrusted"}'` overrode the file's `never`,
  `s14-codexconfig-env.jsonl`); `CODEX_PATH` — path to the codex binary to spawn; `MODEL_PROVIDER`;
  `DEFAULT_AUTH_REQUEST` (Q4). Note the merge happens adapter-side per session/new, so `CODEX_CONFIG`
  can loosen as well as tighten — unlike workspace files.

---

## Q3 — MCP tools

**Verdict: WORKS on both channels.**

- **(a) ACP `session/new` `mcpServers`** (what the daemon forwards from `sessionInit`): accepted with the
  typeless-stdio shape the runner already builds (`{name, command, args, env: [{name, value}]}`);
  codex-acp merges them into the thread config as `mcp_servers` entries and marks the session roots
  trusted. The spike's stdio echo server was spawned, listed, and called (`s9-mcp-acp.jsonl`; the MCP
  server's own request log confirms `initialize`/`tools/list`/`tools/call`). `http`/`sse` typed variants
  are also in the adapter's schema — the runner's HTTP `agenta-tools` entry should work as-is.
- **(b) `config.toml` `[mcp_servers.<name>]`**: identical behavior (`s10-mcp-config.jsonl`).
- **Event stream shape**: an MCP call appears as a normal ACP `tool_call` update:
  `sessionUpdate: "tool_call"`, `kind: "execute"`, `title: "mcp.spike.spike_echo"`,
  `rawInput: {"server": "spike", "tool": "spike_echo", "arguments": {…}}`, then a `tool_call_update`
  with `rawOutput: {"error": null, "result": {"content": [{"type": "text", "text": "SPIKE_ECHO_RESULT:hello-mcp"}]}}`
  and `status: "completed"`.
- **Approval behavior**: MCP tool calls gated under BOTH `untrusted` (`s9`) and `on-request` (`s10`)
  policies, with the MCP-flavored option set (`_meta.is_mcp_tool_approval: true`; options
  allow_once/allow_session/allow_always/decline).
- **F-046 (per-tool pre-allow): WORKS via config.** `[mcp_servers.<name>] default_tools_approval_mode =
  "approve"` made the tool run with ZERO permission requests even under `approval_policy = "untrusted"`
  (`s13-mcp-preallow.jsonl`). The enum is `auto | prompt | writes | approve` (parse error message from a
  direct-CLI probe). A per-tool override shape `[mcp_servers.<name>.tools.<tool>] approval_mode =
  "approve"` parses cleanly (direct-CLI parse probe only — behavior not exercised through the daemon).
  There are also `enabled_tools` / `disabled_tools` lists per server (binary strings; not exercised).
  So codex has a direct analog of Claude's per-tool allow rules, delivered through config instead of
  settings.json.

---

## Q4 — Auth modes

**Verdict: all three forms work; env-var-alone needs one adapter env var.**

- **(a1) `OPENAI_API_KEY` env var ALONE: does NOT work by default.** `session/new` fails with ACP error
  -32000 `Authentication required` (`s1-auth-env-only.jsonl`). codex-acp checks codex's account status
  and only auto-authenticates when `DEFAULT_AUTH_REQUEST` is set.
- **(a2) env var + `DEFAULT_AUTH_REQUEST='{"methodId":"api-key"}'` in the daemon env: WORKS**
  (`s3-defaultauth.jsonl`). The adapter runs an api-key login against env `CODEX_API_KEY` →
  `OPENAI_API_KEY` (that precedence, from the bundle source) and codex then **writes**
  `auth.json = {"auth_mode": "apikey", "OPENAI_API_KEY": "sk-…"}` into `CODEX_HOME`.
- **(a3) pre-seeded `auth.json` `{"OPENAI_API_KEY": "sk-…"}` in `CODEX_HOME`: WORKS** with no env key at
  all (`s2-auth-authjson-apikey.jsonl`). This is the minimal, most predictable API-key setup for the
  runner: write config.toml + auth.json into a throwaway CODEX_HOME and point the session at it.
- **(b) Subscription OAuth: WORKS.** Copied `~/.codex/auth.json` (shape:
  `{"OPENAI_API_KEY": null, "tokens": {"id_token", "access_token", "refresh_token", "account_id"},
  "last_refresh"}`) into a temp CODEX_HOME; the daemon-path session authenticated and completed a prompt
  (`s11-oauth.jsonl`). **No refresh-write was observed** (md5 + mtime of the copied auth.json unchanged
  after the run; tokens were 6 days old and still accepted). Refresh-on-expiry against a copy remains
  unproven — if/when codex refreshes, it will write to the copy in the temp CODEX_HOME, and whether the
  ChatGPT backend invalidates the original login's refresh token at that point was NOT tested. The live
  `~/.codex` was never opened for writing.

---

## Surprises and risks

1. **Workspace files can change codex policy.** Codex 0.145 reads `<cwd>/.codex/config.toml` AND bare
   `<cwd>/config.toml` as config layers. Observed to tighten only (loosening was ignored in `s12e`), but
   this is undocumented-behavior territory: a repo checked out into the workspace can alter gating
   behavior (e.g., force approvals the runner didn't plan for, add MCP servers?, change the model?).
   Which keys the project layer may set was not mapped — worth a follow-up before GA. A workspace
   containing a stray `config.toml` (like this repo's own examples) silently becomes codex config.
2. **The adapter is `@agentclientprotocol/codex-acp`, not `@zed-industries/codex-acp`**, fetched at
   daemon-install time from the ACP registry CDN with a **floating `^1.1.7` npm range** and a bundled
   codex pin inside it. The runner does not control this version today: first-run installs get whatever
   the registry serves (supply-chain + drift risk; the Claude adapter is pinned in package.json by
   contrast). `CODEX_PATH` exists to force a specific codex binary; there is no equivalent pin for the
   adapter itself short of pre-installing the launcher dir.
3. **`gpt-5.1-codex*` model ids are rejected as deprecated** by the backend even though
   `/v1/models` still lists them. The session's advertised models are gpt-5.6-sol/terra/luna, gpt-5.5,
   gpt-5.2 (`s2` session-state). Cheapest for probes: `gpt-5.6-luna`.
4. **Codex's bubblewrap sandbox does not fully initialize on this host** (`bwrap: loopback: Failed
   RTM_NEWADDR: Operation not permitted` — likely because the spike ran in an unprivileged container-ish
   context). Approval flows still worked, but "run inside sandbox" attempts fail, which changes the
   texture of `untrusted` runs (codex asks to run OUTSIDE the sandbox "because the sandbox failed to
   initialize"). Inside the runner's Daytona/Docker sandboxes the same nested-sandbox problem is likely;
   codex has `sandbox_mode` config and the daemon runs in a container, so `danger-full-access` +
   container isolation may be the practical setting (same trade-off the Claude harness makes).
5. **codex-acp auto-trusts the session cwd** (`projects.<cwd>.trust_level = "trusted"` injected into
   every thread config), so codex's own first-run trust prompt never appears on the daemon path.
6. **`approval_policy = "never"` + workspace-write is a real "no gates" mode** (`s7`): nothing pauses,
   the sandbox is the only enforcement. Conversely `untrusted` gates every command (`s4`) — the two ends
   the runner needs for its per-run gate classification both exist and behave.
7. **Codex writes session state into CODEX_HOME** (goals/logs/memories/state sqlite + `installation_id`).
   A per-run throwaway CODEX_HOME therefore also isolates history/memories — but it means codex's
   cross-session memory features silently reset per run unless the runner persists the dir.
8. **One SDK reply nuance**: with reply `"always"`, the SDK picks the first `allow_always` option —
   for codex that is always the SESSION-scoped allow, never the persistent execpolicy amendment /
   "don't ask again". Fine for the runner, but a UI that wants the persistent variants must use
   `rawRespondPermission` with an explicit optionId.

## Transcript index

| File | Scenario |
|---|---|
| `s1-auth-env-only.jsonl` | env key only → Authentication required |
| `s2-auth-authjson-apikey.jsonl` | auth.json api key; also full modes/configOptions dump (earlier gpt-5.1-codex\* runs were overwritten by the final passing run; the deprecation error text is quoted in Q1/versions from those runs) |
| `s3-defaultauth.jsonl` | env key + DEFAULT_AUTH_REQUEST auto-login |
| `s4…s8b` | approval matrix (see Q1 table) |
| `s9-mcp-acp.jsonl` / `s10-mcp-config.jsonl` | MCP via session/new vs config.toml |
| `s13-mcp-preallow.jsonl` | `default_tools_approval_mode = "approve"` under untrusted |
| `s11-oauth.jsonl` | subscription OAuth copy |
| `s12*.jsonl` | project-level config layer probes (b: bare config.toml, c: .codex/, d: control, e: loosening attempt) |
| `s14-codexconfig-env.jsonl` | CODEX_CONFIG env JSON override |
