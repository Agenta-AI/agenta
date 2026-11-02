# Status

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current state

- Research is complete for the runner, Python service, catalog API, frontend query pattern, and
  subscription card.
- The proposed private and public response shapes are in `api-design.md`.
- The founder reviewed this plan on pull request 5985 on 2026-08-12 without change requests.
- Implementation starts from this plan. The decisions below were taken to unblock it and are
  recorded for founder review; each is reversible before the pull request lands.
- The sibling AI-providers plan (`../provider-connections-models/`) consumes this status in its
  subscription rows and picker entries. Terminology stays aligned: the runner reports subscription
  status; the frontend surfaces it under the AI providers experience.

## Recommended decision

Use a private authenticated runner endpoint. Proxy its sanitized status through the Python agent
service. Keep the dynamic status separate from the static harness catalog.

## Decisions taken for implementation (agent, for founder review)

1. **Public route location: the Python agent service.** It already owns the runner URL and token,
   the frontend already calls services directly for runs, and this avoids teaching the main API a
   runner client for one status route. If the route later moves into the main API for generated
   client coverage, the response shape stays the same.
2. **Access permission: the same authentication that protects agent invocation.** The route
   requires an authenticated Agenta user with access to the project, and returns HTTP 200 for the
   three operational runner states.
3. **Pi response shape: one state per harness in the first version.** Pi reports a single state
   even though it can hold more than one provider login. A later version can add a provider map
   without breaking the contract, because the response is versioned.
4. **Frontend text: as written in `api-design.md`.** The card never claims a subscription is
   verified; only a run proves provider access.
5. **Delivery scope: the deployment runner only.** Per-user cloud runners need a server-owned
   runner connection resource first, which is out of scope here. The resolver seam is kept so the
   status request and the model run resolve the same runner.

## Planning constraint

The `plan-feature` instructions request the `design-interfaces` skill for a new response contract.
That skill was not available in this session. The draft applies a manual interface review based on
data ownership, credentials, routing, and runtime status. A later review must use that skill if it
becomes available.
