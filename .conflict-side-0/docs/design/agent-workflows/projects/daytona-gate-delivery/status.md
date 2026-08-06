# Status

## Current state

Implementation is ready for review on the stacked fix branch. The Daytona snapshot recipe
now replaces the base image's private Pi ACP adapter with version 0.0.29, verifies the
private launcher and package version during the build, and keeps the standalone Pi CLI at
0.80.6.

The named `agenta-sandbox-pi` snapshot was force-rebuilt on 2026-07-11. Daytona reported
the snapshot as active after 96.4 seconds.

## Live verification

- Snapshot build: passed. The installer reported private `pi-acp` 0.0.29 at
  `/home/sandbox/.local/share/sandbox-agent/bin/agent_processes/pi-acp`.
- Build assertion: passed with `pi-acp-version=0.0.29`.
- Pi core, allow mode, Bash: passed on Daytona. The command returned
  `QA-BASH-x86_64`.
- Pi core, deny mode, Bash: passed on Daytona. The runner returned
  `Denied by the permission policy.` and the command did not execute.
- Pi core, ask mode: the runner returned a real `interaction_request` instead of
  hanging. This proves the adapter now emits the ACP permission request.
- Sandbox hygiene: zero live sandboxes before the matrix and zero after it.
- Live Agenta deployments: the EE health endpoint on port 8280 and the OSS health endpoint
  on port 8290 both returned `{"status":"ok"}`.

The supported playground approve and reject clicks, the cold approval replay, the
`pi_agenta` opening skill read, and the Claude Daytona control remain to be completed.
Two hand-built raw API resume payloads re-prompted rather than consuming the approval.
That result is not enough to call a product regression because the payloads did not come
from the supported UI client.

## Decisions

- Option A is implemented as adapter parity. No file permission protocol or policy map was
  added.
- ACP remains the only permission plane for Pi builtins on local and Daytona.
- The build checks the private sandbox-agent installation, not a global npm package.
- The correct v0.5.0-rc.2 private install root contains `/bin/agent_processes/`. The
  earlier design text omitted `/bin`; this implementation corrects it.
- Existing sandboxes created before the snapshot rebuild retain their old filesystem and
  must be drained before rollout verification.

## Verification commands

- `python3 -m py_compile services/runner/sandbox-images/daytona/build_snapshot.py`
- `ruff format --check services/runner/sandbox-images/daytona/build_snapshot.py`
- `ruff check services/runner/sandbox-images/daytona/build_snapshot.py`
- `git diff --check`
- `uv run services/runner/sandbox-images/daytona/build_snapshot.py --force`
- `uv run docs/design/agent-workflows/projects/qa/scripts/run_matrix.py --env-label E3 --sandbox daytona --only builtin_bash_pi --timeout 300`

## Remaining work

1. Review and merge the stacked implementation PR.
2. Exercise approve and reject from the playground UI.
3. Confirm cold approval replay through the supported UI message history.
4. Run the `pi_agenta` opening read and one Claude ask-mode control.
5. Update F-018 to resolved after those lifecycle checks pass.

## Provenance

- Design PR: #5218.
- Root cause: the Daytona snapshot inherited `pi-acp` 0.0.23, which predates the Pi
  extension UI permission bridge.
- Implementation review: one narrow implementer and one independent reviewer.
- Live verification date: 2026-07-11.
