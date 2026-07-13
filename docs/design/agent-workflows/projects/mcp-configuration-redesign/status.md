# Status

Last updated: 2026-07-13

## Current stage

Planning complete. No runtime or UI implementation has started in this project.

## Locked decisions

- Public MCP is remote HTTPS only.
- User-authored stdio is removed.
- Internal trusted stdio remains private to the runner.
- Internal `agenta-tools` is never shown in the external MCP editor.
- The editor is gated by an effective deployment and harness capability.
- Version 2 uses `connection`, `credentials`, and `policy` roles.
- The initial acceptance path has no credentials.
- Credential references stay in the contract for later slices.
- The gateway is the long-run execution and secret boundary.
- Pi support follows gateway projection, not a second direct MCP client path.

## Open implementation questions

1. Which exact live deployment and run exhibited enabled MCP without Claude delivery?
2. Should pre-production MCP drafts be reset, or does any external caller require one-release v1
   decoding?
3. Where should ephemeral discovery results live: short-lived server cache or always-fresh test
   responses? They must not become part of the saved author contract.
4. Should an MCP connection failure abort every run in the first slice? The recommendation is yes,
   because optional silent degradation recreates the current failure mode.
5. Which public connection resource will own OAuth references? This does not block no-secret work.

## Next action

Run Slice 0 against the user's exact capability-enabled deployment, then begin the contract-only
Slice 1 while the live root cause is being fixed. The two tasks can proceed independently after
the interface in `interface.md` is accepted.

