# Status

Updated: 2026-08-28.

## Current state

The design is ready for review. No implementation has started.

Tracking issue: [#6336](https://github.com/Agenta-AI/agenta/issues/6336).

This project follows the gateway connection rework in PR
[#6310](https://github.com/Agenta-AI/agenta/pull/6310). It supersedes that project's
gateway-only live policy refresh proposal.

## Decisions

- Refresh is asynchronous and never delays the commit result.
- The service retrieves the complete exact committed revision.
- Initial runs and refreshes share one complete SDK resolution pipeline.
- The service sends complete snapshots rather than patches.
- The runner installs supported atomic facets independently.
- Unsupported facets and failures before mutation keep prior installed state; possible partial
  mutation marks the last known state untrusted.
- Installation and harness observation are separate facts.
- The platform creates no message, turn, continuation, model invocation, or automatic
  session reopen.
- The design accepts that an immediate action may run before refresh installation.
- Gateway execution policy is the first enabled facet.
- The ordinary next run remains the eventual recovery path.

## Review focus

Reviewers should confirm:

1. The private event cannot enter model or public event surfaces.
2. The snapshot cleanly separates stable configuration, credentials, and per-turn data.
3. Replica-addressable active-run targeting works across hosted deployments.
4. Per-facet installed state can represent partial best-effort convergence.
5. Gateway publication keeps authorization, routing, search filtering, and approvals on one
   generation per call.

## Next step

Approve or revise the contracts in this workspace. Implementation then starts with the
shared complete configuration resolver, before any live behavior changes.
