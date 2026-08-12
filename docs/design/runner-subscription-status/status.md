# Status

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current state

- Research is complete for the runner, Python service, catalog API, frontend query pattern, and
  subscription card.
- The proposed private and public response shapes are in `api-design.md`.
- No product code changed.
- No route or response shape has approval.

## Recommended decision

Use a private authenticated runner endpoint. Proxy its sanitized status through the Python agent
service. Keep the dynamic status separate from the static harness catalog.

## Open decisions

1. Public route location: Python agent service or main FastAPI API.
2. Access permission for the public status route.
3. Pi response shape when more than one provider login is present.
4. Final frontend text.
5. Delivery scope. The current code supports one deployment runner. Per-user cloud runners require
   a new server-owned runner connection and routing mechanism.

## Planning constraint

The `plan-feature` instructions request the `design-interfaces` skill for a new response contract.
That skill was not available in this session. The draft applies a manual interface review based on
data ownership, credentials, routing, and runtime status. A later review must use that skill if it
becomes available.
