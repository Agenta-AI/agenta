# Plan

This plan implements Option A from [options.md](options.md): update the Daytona snapshot's
private Pi ACP adapter, keep the existing ACP permission plane, and verify live and cold
approval behavior. It does not add a file-gate protocol or an injected policy map.

## Implementation checkpoint

The snapshot recipe now pins the private Pi ACP adapter to 0.0.29 and asserts the
actual private launcher and package under
`/home/sandbox/.local/share/sandbox-agent/bin/agent_processes/`. The named
`agenta-sandbox-pi` snapshot was force-rebuilt successfully on 2026-07-11.

Focused Daytona verification passed allow-mode Bash and deny-mode Bash. Ask mode produced
a real `interaction_request` immediately, which proves the repaired adapter emitted
`session/request_permission` through the existing ACP HTTP/SSE path. The supported UI
approve/reject continuation and Claude control remain follow-up checks.

## Phase 0: confirm the deployed version

- Create one short-lived Daytona sandbox from the currently selected
  `agenta-sandbox-pi` snapshot.
- Query the private Pi adapter that sandbox-agent resolves, not only a global npm package.
  Record the launcher path and version. Expect 0.0.23.
- Record the snapshot id or build identity so the evidence is tied to an artifact.
- Delete the sandbox and confirm the live sandbox count returns to its starting value.

If the deployed private adapter is already 0.0.28 or newer, stop. Instrument Pi's raw
`extension_ui_request` and adapter stdout before changing the snapshot recipe. The source
proof explains the checked-in recipe, but the live artifact wins if it differs.

## Phase 1: pin adapter parity in the snapshot recipe

Change `services/runner/sandbox-images/daytona/build_snapshot.py`:

- Add `PI_ACP_VERSION = "0.0.29"` beside the existing Pi CLI version.
- After the image switches to `USER sandbox`, run:

  ```dockerfile
  RUN sandbox-agent install-agent pi --reinstall --agent-process-version 0.0.29
  ```

- Add a build-time assertion against the private adapter installation under
  `/home/sandbox/.local/share/sandbox-agent/bin/agent_processes/`. The assertion must prove the
  resolved adapter is exactly 0.0.29.
- Keep the standalone Pi CLI pin at 0.80.6. The CLI and ACP adapter are different
  dependencies with different responsibilities.
- Update `services/runner/sandbox-images/daytona/README.md` to list both pins and explain
  why the recipe must not trust the base image's adapter manifest.

Do not use only `npm install -g pi-acp`. sandbox-agent prefers its private launcher, so a
global package can leave the stale adapter active.

## Phase 2: rebuild and rotate the snapshot

- Force-rebuild `agenta-sandbox-pi` in the intended Daytona target.
- Verify the snapshot build prints and asserts adapter 0.0.29.
- Update the runner deployment only if the snapshot name changes. Reusing the name still
  requires draining sandboxes created from the prior snapshot because their filesystems
  retain the old adapter.
- Confirm the next sandbox is created from the rebuilt artifact and resolves adapter
  0.0.29 before starting an LLM run.

## Phase 3: verify permission correctness

Run the smallest matrix that proves the gate and its policy outcomes:

1. Pi core, allow mode, read.
2. Pi core, allow mode, bash.
3. Pi core, deny mode, one builtin.
4. Pi core, ask mode, approve once.
5. Pi core, ask mode, reject once.
6. Pi Agenta, opening skill read, which covers the build-kit regression.
7. Pure chat control.

For each tool run, require both:

- runner evidence that `[HITL] pi-gate` received the request; and
- user-visible evidence that the tool executed or was denied as expected.

Capture request and response pairs under `projects/qa/runs/` and update F-018 after the
live checks pass. Use a cheap model and assert the Daytona sandbox count before and after
every run.

## Phase 4: verify both approval lifecycles

### Live

- Keep the Daytona sandbox and ACP prompt alive through an ask gate.
- Approve once and reject once.
- Verify the runner answers the held permission id through `respondPermission`.
- Verify the original call continues with its original arguments and no model reissue.

### Cold

- Create an ask gate, then let the live continuation disappear through the supported
  cold-transition test path.
- Persist the human decision.
- Resume with a restarted or recreated session.
- Verify the model reissues the pending call and the new ACP gate consumes the stored
  decision.

Do not expect a stopped sandbox to retain a permission id or prompt promise. A successful
cold test proves durable approval and replay, not live transport continuity.

## Phase 5: test the scope boundary

- Run one Claude ask-mode tool on Daytona. Record it as a separate control because F-018
  is a Pi adapter defect.
- Confirm Pi user MCP remains rejected, user stdio MCP remains disabled, and no design
  text claims otherwise.
- Do not expand this fix to Claude gateway-tool delivery on Daytona. That is a separate
  loopback reachability problem.

## Phase 6: fallback decision gate

Option B remains closed unless all of these are true after the snapshot rebuild:

1. The sandbox resolves `pi-acp` 0.0.29.
2. Raw adapter instrumentation shows it emits `session/request_permission`.
3. The sandbox-agent SSE server records the envelope.
4. The outer runner does not receive it over the signed preview URL.
5. A minimal mock SSE probe reproduces the loss independently of Pi and the LLM.

If those conditions hold, first ask Daytona whether the managed signed-preview path
supports one long-lived SSE GET plus concurrent POSTs. Evaluate a standard preview token
or a direct/private ingress before designing a filesystem permission protocol.

## Phase 7: optional latency work

Measure the added latency of the repaired ACP round-trip for allow and deny builtins. Only
if it materially affects user-visible tool latency should a new design consider Option C.
That proposal must independently review the runner-to-sandbox policy interface and threat
model. It is not part of the F-018 fix.

## Tests and acceptance criteria

- Snapshot build fails when the private Pi adapter is not exactly the pinned version.
- Local and fresh Daytona sandboxes resolve the same `pi-acp` version.
- Allow, deny, and ask work for Pi builtins on Daytona.
- Live approval continues the original call.
- Cold approval answers a reissued call with a durable decision.
- The build-kit default agent completes its opening read on Daytona.
- Pure chat remains green.
- No test sandbox leaks.
- No new wire field, public config field, file-gate protocol, or policy-injection map lands.
