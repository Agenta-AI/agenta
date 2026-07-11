# Status

## Current state

Design revised after owner review. No implementation code changed. Research identified the
root cause as Pi ACP adapter version skew, not Daytona preview-proxy behavior.

The checked-in snapshot recipe inherits `pi-acp` 0.0.23 from
`rivetdev/sandbox-agent:0.5.0-rc.2-full`; local runs use the repo-pinned 0.0.29. Version
0.0.23 predates the extension UI permission bridge. The proposed fix is now a snapshot
dependency pin and rebuild.

## Decisions

- Option A is the primary correctness fix.
- Option A means adapter parity, not a Daytona proxy rewrite.
- ACP remains the only permission plane for Pi builtins on local and Daytona.
- Option B is not planned. It opens only if a fresh, corrected adapter emits a permission
  request that a focused transport probe proves is lost after emission.
- Option C does not depend on Option B. It is deferred as a separate latency optimization.
- Live and cold approval are separate lifecycle paths:
  - live answers the held ACP permission id and continues the original call;
  - cold stores the human decision, recreates or reloads, and answers the reissued call.
- A file relay cannot preserve a pending RPC after the process holding it has stopped.
- F-018's evidence applies to Pi. Claude ask on Daytona needs its own control run.
- Pi custom and gateway tools use the extension execution relay, not user MCP.

## Evidence

- `services/runner/package.json` pins local `pi-acp` 0.0.29.
- `services/runner/src/engines/sandbox_agent/daemon.ts` puts the local runner dependency on
  the daemon `PATH`.
- `services/runner/sandbox-images/daytona/build_snapshot.py` inherits ACP adapters from
  `rivetdev/sandbox-agent:0.5.0-rc.2-full` and installs only the standalone Pi CLI.
- The upstream 0.5.0-rc.2 adapter manifest pins `pi-acp` 0.0.23.
- The upstream 0.0.23 adapter has no `extension_ui_request` handler.
- The bridge landed in pi-acp commit `1412ea6110` and shipped in 0.0.28.
- The installed 0.0.29 adapter converts confirm dialogs to ACP permission requests.
- The last public Daytona proxy source uses a generic Go reverse proxy and contains no
  ACP method filter.

## Remaining validation

- Query the private adapter version in the currently deployed snapshot.
- Rebuild a temporary or replacement snapshot with 0.0.29.
- Run the allow, deny, ask-live, and ask-cold checks in [plan.md](plan.md).
- Run one Claude Daytona ask control.
- Measure the repaired ACP round-trip before considering Option C.

The live Daytona checks require confirmation that cloud credits are available. Every run
must count sandboxes before and after and delete its test sandbox.

## Blockers

None for the design. Implementation and live verification require a Daytona snapshot
rebuild window and available credits.

## Next steps

1. Review this revised design.
2. If approved, implement the snapshot recipe pin and build assertion.
3. Rebuild and rotate `agenta-sandbox-pi`.
4. Run focused live verification.
5. Close or reopen the transport contingency from evidence.

## Provenance

- Finding: F-018 in [../qa/findings.md](../qa/findings.md).
- Owner review: nine inline threads on PR #5218.
- Research pass: three independent tracks for Daytona proxy source, sandbox-agent and ACP
  transport, and permission lifecycle and harness scope.
- No live Daytona sandbox was started during this review pass.
