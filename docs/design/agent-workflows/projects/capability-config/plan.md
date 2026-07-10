# Execution plan

> Superseded: the permission/approval model described here was redesigned in [projects/approval-boundary/](../approval-boundary/) (2026-07). Kept as a dated record.

Phased, end to end. Each phase is shippable and de-risks the next. File references and exact
insertion points live in `research.md`; this plan names the work and the acceptance bar. Some
line numbers in `research.md` are approximate and must be reconfirmed at implementation time.

The dependency spine: Phase 0 unblocks Pi and the metadata defaults. Phases 1 to 3 build the
three layers in the backend and runner. Phases 4 and 5 surface them in the playground. Phase 6
verifies live. Phases 1 and the Composio half of Phase 0 are independent and can run in
parallel.

## Phase 0: prerequisites

Two latent gaps that the rest of the design assumes are closed.

- **(S0b) Investigate Pi's real control surface.** The runner does drop `request.tools`
  (`run-plan.ts:101`), but `pi-acp@0.0.29` spawns `pi --mode rpc --no-themes` with no `tools`
  field on `newSession` (`index.js:135`), so honoring `builtin_names` is not simply a matter of
  forwarding `request.tools`. Find the actual lever — a `pi` CLI flag, a Pi config file written
  into the cwd, or an ACP session field — or conclude that Pi built-in restriction is unsupported
  over sandbox-agent. Read-only; record the finding in `research.md`.
- **(S0a) Stop stripping Composio read/write hints.** Carry a `read_only` flag from the catalog
  through to the resolved tool, so Phase 3 can default permissions from it.
  (`api/oss/src/core/tools/providers/composio/catalog.py`, `api/oss/src/core/tools/dtos.py`, the
  resolved `ToolSpec`.)

Acceptance: S0b ends with a written finding (the lever, or "unsupported → fail loud"); S0a makes
a resolved Composio tool carry `read_only` on the wire (read-only for `readOnlyHint`, mutating for
`destructiveHint`/`updateHint`). If S0b finds Pi restriction unsupported, Layer 1 for Pi fails
loud rather than silently granting the full tool set.

## Phase 1: Layer 2, sandbox permission (backend)

The network boundary, enforced at sandbox provisioning. Filesystem is declared but not enforced
yet (no backend confines it).

- Add an optional `sandbox_permission` object to `AgentConfig` and the `agent_config` schema
  (presets plus `network_egress` with `mode` and `enforcement`). (`dtos.py`,
  `sdk/utils/types.py` `AgentConfigSchema`, `services/oss/src/agent/schemas.py`.)
- **Thread the policy across the Python→TS wire**, because Daytona is provisioned in the runner,
  not in Python: `SessionConfig` → `request_to_wire` (`sdk/agents/utils/wire.py`) →
  `AgentRunRequest` (`protocol.ts`) → `buildRunPlan` (`run-plan.ts`) → `buildSandboxProvider`.
  Move the golden fixtures and both wire-contract tests with the new field. The Python
  `Backend.create_sandbox` also gains the typed policy for the local/in-process path.
- Apply it on Daytona: set `networkBlockAll` / `networkAllowList` on the provider `create`
  object. (`services/agent/src/engines/sandbox_agent/provider.ts`.)
- Fail loud when a backend cannot enforce a requested guarantee (local sidecar, local SDK),
  unless the author sets a per-axis opt-out.
- **(S1g) Close the runner-host hole before claiming `network: off`.** `relay.ts` runs `code` and
  gateway/callback tools on the runner host, so a network-blocked Daytona sandbox does not confine
  them. When `network: off`/`exec: off`, reject or strip `code` tools, gateway/callback tools, and
  stdio MCP servers — or move their execution into the sandbox. The runner must not report
  `network: off` while a runner-side tool is still reachable. See `status.md` open question 1.

Acceptance: a `network: off` config on Daytona blocks egress (a `curl` from `bash` fails) **and**
a `code`/gateway tool under that config either refuses at plan time or runs inside the sandbox,
never on the runner host; the same config on local fails loud unless opted out.

## Phase 2: Layer 1, harness configuration (settings.json)

The runner renders author kwargs into the harness's native config.

- Define the `harness_options` surface for Claude: permission mode plus per-tool allow/deny/ask
  rules. Decide raw `ClaudeCodeSettings` passthrough vs a curated subset. (`dtos.py`
  `harness_options`.)
- In the runner, write `.claude/settings.json` into the session cwd before `createSession`.
  (`run-plan.ts` cwd creation; the engine before `sandbox.createSession` in `sandbox_agent.ts`.)
- Derive the baseline rules from Layer 2 and the read-only profile (for example `network: off`
  emits `deny: ["WebFetch","WebSearch"]`; read-only emits `deny: ["Write","Edit","Bash"]`).

Acceptance: a Claude run with a settings.json `deny` rule does not call the denied tool; a
`defaultMode` setting takes effect.

## Phase 3: Layer 3, tool permission (backend + runner)

Per-tool permission: always-allow / ask / deny.

- Carry the permission on each tool's spec and each MCP server's spec. The frontend already
  stores `agenta_metadata.permission_mode` on each tool; define its canonical values
  (always-allow/ask/deny) and serialize them. `permission_policy` stays as the global default.
  Add `read_only` to `ToolSpec` (Phase 0). (`dtos.py`, `tools/models.py`.)
- Enforce resolved tools at the relay: deny refuses, ask parks, always-allow runs.
  (`services/agent/src/tools/relay.ts`.)
- Enforce Claude builtins through the responder: pass the per-tool map to the responder, which
  reads the tool name off the permission request and applies the permission.
  (`responder.ts`, `engines/sandbox_agent/permissions.ts`.)
- Default the permission from the `read_only` flag: read-only to always-allow, mutating to ask.
  The author overrides.

Known risk handled in S1g (Phase 1), not here: resolved `code` **and** gateway/callback tools run
on the runner host, not the sandbox, so a network-blocked Daytona run does not confine their
egress. The interim guard (reject `code`, gateway/callback, and stdio MCP when `network`/`exec`
are off) versus the target (move resolved-tool execution into the sandbox) is decided there. See
`status.md` open question 1.

Acceptance: a tool set to deny never runs; a tool set to ask raises an approval request; a
read-only Composio tool defaults to always-allow.

## Phase 4: playground form (the three sections)

The form is generic-schema-driven, so most fields appear once the schema carries them. The
work is the controls and the gating.

- Render the new sections in `AgentConfigControl.tsx`: a sandbox-permission section (presets
  plus network/filesystem toggles), an advanced harness-config section, and a per-tool
  permission control (allow / ask / deny on each tool). NOTE (S3a finding): `permission_mode` is
  NOT round-tripped in the FE today — this control must be built from scratch, writing
  `agenta_metadata.permission_mode` with the `allow|ask|deny` vocabulary (the SDK already accepts
  that key via `AliasChoices`, so no mapping is needed).
- Default the per-tool control from the tool's `read_only` metadata.
- Gate fields by the live `harness` value (hide `permission`-mode controls for Pi, hide
  `mcp_servers` where not applicable), reading the harness-capabilities map from `/inspect`.
  (`AgentConfigControl.tsx`, `SchemaPropertyRenderer.tsx`.)

Acceptance: an author sets a preset and a per-tool permission in the playground, saves, and the
values persist on the variant config and reach the run.

## Phase 5: playground HITL approval surface (the "ask" path)

The chat already exposes `addToolApprovalResponse` (`AgentChatPanel.tsx:86`) **and** already
renders approve/deny buttons (`ToolPart.tsx:153`). So the UI is largely built; the missing piece
is the runtime parked/resumed path, not the buttons.

- Map the runner's `interaction_request` (permission) event onto the ai-sdk approval part, so a
  Layer 3 "ask" in the runtime surfaces as the existing approval UI, and route the user's
  decision back through `addToolApprovalResponse` to resume (or reject) the parked call.
  (`web/oss/src/components/AgentChatSlice/`: `AgentChatPanel.tsx`, `AgentMessage.tsx`,
  `ToolPart.tsx`; runner responder seam `responder.ts`, `permissions.ts`.)
- Confirm the responder actually parks the call and resumes it on the answer (the underestimated
  part), rather than only rendering a prompt.

Acceptance: a tool set to ask shows the approve/deny prompt in the playground chat, and the
answer resolves the parked call end to end.

## Phase 6 (S6): tests and live verification

**Unit / golden — DONE.** The settings.json builder, the relay permission enforcement, the
`resolvePermission` table, the `HITLResponder`, the Composio `read_only` mapping, and the
permission default ladder are all unit-tested; the new wire fields cross the golden fixtures and
both contract tests. 293 SDK + 15 API + 10 services/oss + 177 TS pass.

**Live — PENDING (needs a deployed stack).** The running dev stack is
`agenta-ee-dev-wp-b2-rendering` (traefik `:8280`, sandbox-agent sidecar `:8765`). The SDK changes
need a container reload and the TS-runner changes need a sandbox-agent image rebuild before these
checks reflect this branch. Run each check and record pass/fail here:

1. **L2 Daytona `network: off` blocks egress (E3).** Config `sandbox_permission.network.mode=off`,
   harness `pi` or `claude`, sandbox `daytona`. Make the agent run `curl https://example.com` (or
   a `code` tool doing a fetch). Expect egress to FAIL. Confirm the Daytona create call carried
   `networkBlockAll: true` (sidecar logs). Re-run with `enforcement=strict` on the LOCAL sidecar:
   expect the run to fail loud at plan time, not silently.
2. **L2 runner-host guard (S1g).** Config `network: off`, `enforcement=strict`, plus a `code` or
   gateway tool (or a stdio MCP server). Expect the run to be REJECTED at plan time with the
   runner-host message. With `enforcement=best_effort`, expect it to run.
3. **L1 Claude `settings.json` deny (E2/E3, claude).** Author `harness_options.claude.permissions.deny=["WebFetch"]`
   (or `network:off` to derive it). Ask Claude to fetch a URL. Expect Claude NOT to call WebFetch.
   Confirm `<cwd>/.claude/settings.json` was written (sidecar logs / Daytona FS). Also verify a
   `defaultMode` takes effect.
4. **L1 MCP `mcp__<server>` rule.** An MCP server with `permission:"deny"` → confirm Claude cannot
   call its tools; `permission:"allow"` → confirm it runs without a prompt.
5. **L3 per-tool deny / read-only default.** A gateway tool with `permission:"deny"` → the relay
   refuses it (refusal string in the transcript, tool not executed). A read-only Composio tool with
   no explicit permission → defaults to allow (runs without a prompt). A mutating one → defaults to
   ask. Verify the permission survived the save (it is a TOP-LEVEL `permission` key on the tool,
   not in `agenta_metadata`).
6. **L3 HITL multi-turn round-trip (the deferred S5 unknown).** In the `/messages` playground chat,
   trigger an `ask` tool. Turn 1: expect a `tool-approval-request` to surface (approve/deny buttons)
   and the tool NOT to run. Approve. Turn 2: expect the gate to re-raise and the tool to actually
   run; deny variant: expect refusal. THIS is the unverified design assumption (cold-replay
   re-raise) — see `../../scratch/open-issues.md`. If turn 2 does not re-raise, apply the fallback
   noted there.
7. **Surfaces.** Drive checks 1–5 via BOTH the SDK (E4 script pulling config + running on host) and
   the playground UI (`mcp__chrome-devtools__*` against `:8280`). The playground form (S4) must
   render the three sections, gate the Claude section to the claude harness, and persist values
   that reach the run.

**Pin a replay regression.** Capture one green `/run` per layer, redact volatile fields, and write
a replay test (`agent-replay-test` skill) so the cells stay green cost-free in CI.

Acceptance: the matrix in `../qa/` gains capability + per-tool-permission rows, green on the
harness/backend pairings the enforceability table claims.
