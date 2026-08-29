# Sandbox gateway research v1

Status: exploratory design, not implementation-ready
Branch: `feat/add-sbx-gateway`
Last updated: 2026-08-27

## Posture

The sandbox gateway should become the Agenta-owned boundary for sandbox identity,
policy, lifecycle, credentials, mounts, connectivity, and accounting. A runner or
agent service should ask for a sandbox and receive an opaque handle plus scoped
endpoints. It should not choose a provider, retain a provider handle, inject
customer credentials, mount durable storage, or repair provider lifecycle state.

This is a stateful resource gateway. It should reuse the policy, identity,
secret-resolution, audit, endpoint naming, and metering work from the LLM and MCP
gateways, while keeping a separate lifecycle and data-plane model. Treating it as
another request proxy would hide the hard parts: reconciliation, leases,
generations, bootstrap, streaming connections, mounts, and compensating cleanup.

The first security objective is to remove upstream LLM and MCP secrets from the
service-to-runner wire and sandbox environment. Sandboxes should receive scoped
Agenta gateway credentials. Where a workload must authenticate directly to an
external HTTP service, the default should be an outbound credential broker that
injects the real credential after traffic leaves the untrusted workload.

## Reading order

1. [Architecture](architecture.md) describes the initial control-plane and
   data-plane split, bootstrap flow, secret and mount boundaries, and migration.
2. [Entities](entities.md) defines the durable aggregates, value objects,
   relationships, and persistence invariants.
3. [Interfaces](interfaces.md) defines the north ports, south ports, endpoint
   tickets, provider adapter contract, and error semantics.
4. [Providers](providers.md) maps local, Docker, Daytona, E2B, and Kubernetes
   Agent Sandbox onto one honest capability model.
5. [Plan](plan.md) divides the work into mergeable packages and deployable
   checkpoints.
6. [Acceptance tests](acceptance-tests.md) specifies the shared conformance suite
   and provider-specific live tests.
7. [Raw research](rawresearch.md) records the current Agenta behavior and external
   systems that informed the proposal.
8. [Notes](notes.md) captures working positions, unresolved questions, and
   experiments worth running.
9. [Out of scope](outofscope.md) keeps this first design pass bounded.

## Scope of this pass

This pass establishes vocabulary, boundaries, invariants, a capability model,
and an incremental migration direction. It deliberately does not freeze the API
schema, database model, provider SDK, endpoint paths, or deployment topology.

## Initial thesis

1. A logical sandbox is an Agenta resource, not a Daytona or E2B object.
2. Provider identifiers and credentials remain inside provider adapters.
3. A sandbox handle remains stable while its provider generation and endpoint
   tickets may change after pause, resume, replacement, or migration.
4. Control operations go through the Agenta API. Workload traffic goes through a
   sandbox data plane or a short-lived capability with equivalent authorization,
   revocation, and audit.
5. Desired secret bindings and mount specifications are durable; resolved secret
   values, STS credentials, and endpoint tickets are not.
6. `local` is an explicit development provider, not evidence of isolation.
7. Unsupported security controls fail closed and surface in provider capability
   negotiation.
