# Out of scope for v1 research

This document limits the first research dossier. Items here may become later
designs; they are not rejected features.

## Implementation and rollout detail

- production code, migrations, provider SDK selection, deployment manifests, and
  workstream ownership;
- a final REST/OpenAPI schema, database schema, event schema, or SDK surface;
- a committed delivery schedule or provider launch order;
- a full compatibility or load-test suite, beyond identifying needed experiments;
- immediate removal of current runner paths before a gateway facade proves parity.

## Provider breadth

- implementing every commercial sandbox provider;
- treating arbitrary customer URLs as trusted provider adapters;
- a generic OCI image builder, package registry, or snapshot marketplace;
- a multi-cloud placement optimizer, spot-capacity broker, or global scheduler;
- promising live migration of a running process between providers;
- production guarantees for the current local child-process provider.

## Adjacent gateway redesigns

- redesigning the LLM gateway protocol adapters, model catalog, routing, or
  pricing;
- redesigning the MCP gateway catalog, consent UI, OAuth flow, or stdio hosting;
- replacing the shared gateway identity, policy, secret ownership, or wallet
  proposals; the sandbox design consumes those contracts and records gaps;
- exposing upstream LLM or MCP provider credentials to sandbox adapters as a
  compatibility shortcut.

## General compute platform features

- arbitrary public application hosting or permanent ingress;
- arbitrary TCP/UDP forwarding; the initial data plane focuses on declared HTTP,
  WebSocket, and standard sandbox endpoints;
- desktop streaming, browser automation, GPU scheduling, or notebook product UX;
- cron jobs, background services unrelated to an active sandbox lease, or a
  general serverless platform;
- collaborative IDE semantics, FS conflict resolution, or source-control
  synchronization beyond mount and file primitives.

## Storage and secrets beyond the boundary

- replacing Agenta's object store or vault implementation;
- designing a universal distributed FS;
- making FUSE semantics identical across providers;
- claiming local-use secrets are hidden from code running in the sandbox;
- persisting resolved secret values, STS credentials, provider access tokens, or
  endpoint tickets as part of the logical sandbox record;
- snapshotting credential-broker memory or treating a provider snapshot as a
  complete Agenta bootstrap checkpoint.

## Billing and policy detail

- exact prices, wallet reservation formulas, quota limits, or invoice presentation;
- a final mapping from every provider usage signal to billable dimensions;
- legal/compliance certification of any provider or isolation technology;
- a complete human-consent product flow, though the architecture identifies the
  actions that likely require one.

## Deliberately unresolved

The following are design choices, not implementation scope for this pass:

- mandatory relay versus delegated data-plane endpoints;
- ownership and sharing semantics for reusable sandboxes;
- lease concurrency and writer exclusivity;
- endpoint token format and revocation mechanism;
- whether to operate OpenSandbox or only implement it as an adapter;
- the long-term bridge for stdio MCP servers;
- provider-specific extension syntax.
