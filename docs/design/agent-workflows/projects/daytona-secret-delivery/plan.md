# Plan

Implementation starts after the decisions in `open-questions.md` are resolved.

## Phase 0: prove Daytona behavior

Use a non-production Daytona organization and disposable credentials.

1. Pin the spike to one exact `@daytona/sdk` version at or above 0.192.0.
2. Prove environment-backed Secret substitution with one random marker and one exact HTTPS host.
3. Prove direct placeholder substitution when the placeholder is placed in an HTTP MCP header
   through ACP session configuration.
4. Confirm plaintext is absent from environment, `/proc`, files, process arguments, stdout,
   stderr, ACP payload logs, and traces.
5. Test the exact host, a different host, a subdomain, redirects, explicit ports, DNS changes, and
   proxy failures. Reject every wildcard in the first version.
6. Test Secret create, read, update, delete, sandbox stop, resume, manual archive, delete, and
   auto-delete. Confirm Secret reads and audit records never return plaintext.
7. Verify PATCH semantics. Reassert and read back the exact host set on rotation even though
   Daytona documents omitted fields as unchanged.
8. Measure latency, list behavior, rate limits, and organization quotas at realistic lease counts.

Exit gate: stop if plaintext appears inside the sandbox, direct MCP-header substitution fails
without a safe alternative, host restrictions can be bypassed, or lifecycle and quotas make
per-sandbox leases impractical.

## Phase 1: replace the resolved credential contract

1. Replace top-level model `secrets` with consumer-owned `modelConnection.credentials`.
2. Make the resolver emit the effective HTTPS model endpoint for direct, custom, Azure, and
   candidate Bedrock bearer-token deployments.
3. Replace HTTP MCP's merged `env` secret values with typed header credential bindings. Keep
   non-secret environment configuration separate.
4. Classify each binding as `opaque_http` or `local_use` and validate combinations.
5. Materialize the same contract to plaintext environment or headers for local runs.
6. Add contract tests across Python serialization, TypeScript parsing, Pi, and Claude.
7. Require missing names, empty values, and vault-resolution errors to fail before runner dispatch.

Exit gate: local behavior works from the new contract with no compatibility copy of the old field,
and model and MCP routes remain attached to their credentials.

## Phase 2: isolate and pin the Daytona dependency

1. Replace `@daytonaio/sdk` with one exact `@daytona/sdk` version.
2. Extend the runner-owned Daytona lifecycle wrapper with Secret create, attach, delete, and
   compensation hooks. Do not patch upstream for these hooks.
3. Keep native pause, reconnect, and delete in the runner wrapper. Keep the vendored
   `sandbox-agent@0.4.2` patch limited to cleanup behavior that belongs inside that package.
4. Preserve current snapshot, target, network policy, signed preview, daemon start, mount,
   stop/resume, and auto-delete behavior. Do not restore auto-archive configuration.
5. Add startup capability validation for unsupported self-hosted Daytona control planes.
6. Run the full runner unit suite, typecheck, and live Daytona smoke before Secret delivery is
   enabled.

Exit gate: existing Daytona behavior works on the pinned SDK and lifecycle ownership is explicit.

## Phase 3: model and HTTP MCP credentials

1. Add the per-sandbox Secret lease provisioner.
2. Derive one exact hostname from each validated effective consumer URL.
3. Put environment bindings in Daytona's sandbox create `secrets` map.
4. Put HTTP MCP placeholders in header bindings using the Phase 0 proven path.
5. Support direct provider keys, Azure keys, custom-provider keys, and HTTP MCP authorization.
6. Add Bedrock bearer tokens only if the regional endpoint and live substitution tests pass.
7. Keep SigV4 and Vertex service-account credentials in the approved explicit non-isolated mode or
   reject them when the run requires strict isolation.
8. Never fall back to plaintext after Secret provisioning, attachment, or substitution fails.

Exit gate: supported consumers work, unsupported modes are explicit, and plaintext checks remain
clean.

## Phase 4: crash-safe leases and cleanup

1. Store only lease ID, sandbox ID, Secret IDs and names, exact hosts, binding metadata, timestamps,
   and state. Never store plaintext or vault slugs.
2. Compensate partial Secret creation and sandbox creation failure.
3. Retain leases across stop and resume.
4. On credential-epoch mismatch, delete the old sandbox and lease and provision fresh.
5. Delete Secrets only after sandbox deletion is confirmed or absence is confirmed.
6. Add durable cleanup retries and an organization-wide janitor.
7. Cover runner crash, failed persistence, Daytona auto-delete, manual archive, concurrent cleanup,
   and paginated listing.

Exit gate: fault injection and a runner-kill live test converge to zero orphan Secrets.

## Phase 5: rollout and hardening

1. Require the approved organization and API-key isolation boundary.
2. Roll out by environment, then by a small percentage of Daytona sessions.
3. Report resolved credential delivery as `isolated` or `non_isolated` without exposing values,
   Secret names, or placeholders.
4. Add operator policy for `isolated_required` versus an approved non-isolated migration mode.
5. Document supported provider credential shapes and the minimum Daytona version.
6. Keep local and unsupported-cloud gateway work as separate follow-up projects.

Metrics cover Secret API latency and failures, authentication failures, active leases, orphan age,
cleanup retries, and fail-closed counts. An environment-level rollback may disable Secret delivery
during rollout, but no individual run may downgrade silently.

## Dependencies and coordination

- Resolve every item in `open-questions.md`.
- Coordinate the model connection shape with `provider-model-auth` and custom providers.
- Coordinate HTTP MCP credential bindings with the current MCP resolver and SSRF guard.
- Build on the current warm-Daytona runner wrapper and credential-epoch compatibility behavior.
- Coordinate durable lease storage with the sessions control-plane owner.
