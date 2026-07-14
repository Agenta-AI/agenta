# Status

Last updated: 2026-07-13

## Current stage

Slices 0 through 2 are implemented in the working tree and under validation.

## Locked decisions

- Public MCP is remote HTTPS only.
- User-authored stdio is removed.
- Internal trusted stdio remains private to the runner.
- Internal `agenta-tools` is never shown in the external MCP editor.
- The editor is gated by the selected harness's runtime catalog capability.
- The breaking contract uses `connection`, `credentials`, and `policy` roles.
- The initial acceptance path has no credentials.
- Credential references stay in the contract for later slices.
- There is no compatibility decoder, feature flag, or frontend MCP environment variable.
- Claude continues using ACP HTTP MCP delivery.
- Pi is the immediate slice 2.2 follow-up; its bridge versus gateway decision is not made here.

## Open implementation questions

1. Which exact live deployment and run exhibited enabled MCP without Claude delivery?
2. Where should ephemeral discovery results live: short-lived server cache or always-fresh test
   responses? They must not become part of the saved author contract.
3. Should an MCP connection failure abort every run in the first slice? The recommendation is yes,
   because optional silent degradation recreates the current failure mode.
4. Which public connection resource will own OAuth references? This does not block no-secret work.

## Next action

Finish automated checks, publish the slices 0-2 implementation PR, then run Claude acceptance and
open the separate Pi 2.2 and product-feature slice 3 planning PRs.
