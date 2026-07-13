# Plan

## Phase 0: prerequisites and measurements

1. Finish Claude no-secret acceptance in local and Daytona.
2. Finish the Pi 2.2 delivery design.
3. Record where Claude and Pi own MCP or tool sessions, calls, and errors.
4. Choose direct clients or gateway using latency, credential boundary, session ownership, and
   operating cost.

Exit: one documented execution owner, with rejected alternatives and migration consequences.

## Phase 1: connect and status

1. Add a test-connection operation that uses the chosen production client path.
2. Return redacted initialization status, negotiated server identity, capabilities, and errors.
3. Surface status in the MCP editor without mutating saved revisions.
4. Add retry and reconnect only where the underlying client supports deterministic semantics.

Exit: a user can distinguish saved, connecting, connected, and failed.

## Phase 2: discovery and policy

1. Return discovered tool schemas from the connection operation.
2. Populate selection from discovery rather than free text.
3. Persist explicit `all` or `include` intent.
4. Enforce the same selection on tool listing and tool calls.
5. Show renamed or missing selected tools without widening access.

Exit: selected tools are observable and enforceable.

## Phase 3: credentials

1. Enable static header secret references on the chosen execution boundary.
2. Add a platform OAuth connection resource and `oauth_connection` discriminator.
3. Redact service, runner, gateway, ACP, sandbox, trace, and UI error surfaces.
4. Test revocation, refresh, missing references, and host restrictions.

Exit: no raw credential appears in a revision or user-visible response.

## Phase 4: parity and rollout

1. Run Claude and Pi across local and Daytona.
2. Compare connect, list, call, policy denial, reconnect, and credential behavior.
3. Publish capability details only for cells that pass.
4. Add replay or deterministic integration coverage for each delivery adapter.

Exit: the runtime catalog truthfully represents the supported matrix.
