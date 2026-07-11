# Plan

This is a design-only plan. Implementation starts only after review and approval.

## Phase 0: prove Daytona's security behavior

Use a non-production Daytona organization and disposable credentials.

1. Pin a small spike to `@daytona/sdk` 0.196.0 or the reviewed exact version selected at
   implementation time.
2. Create a Secret with a random value and one controlled HTTPS echo host.
3. Create a sandbox with the Secret attached at creation.
4. Prove the sandbox sees only a `dtn_secret_*` placeholder in environment, files, `/proc`, process
   arguments, stdout, and stderr.
5. Prove the allowlisted host receives plaintext and a non-allowlisted host receives only the
   placeholder.
6. Test redirects, subdomains, explicit ports, alternate URL forms, DNS changes, proxy errors, and
   logs.
7. Test value and host rotation, detach, Secret deletion while attached, pause, archive, resume,
   sandbox deletion, and auto-delete.
8. Measure Secret create/update/delete latency, rate limits, and organization quotas with realistic
   per-sandbox counts.

Exit gate: do not implement if plaintext appears inside the sandbox, host restrictions can be
bypassed, lifecycle semantics cannot be reconciled, or quotas make per-sandbox leases impractical.

## Phase 1: isolate and pin the Daytona dependency

1. Add the current exact `@daytona/sdk` package. Remove the caret for this security-sensitive
   dependency.
2. Implement an Agenta-owned sandbox-agent Daytona provider adapter with dependency injection.
3. Preserve current create, signed preview, server start, destroy, and reconnect behavior.
4. Add native `pause()` support so keep-warm no longer falls back to deletion.
5. Run runner unit tests and live Daytona smoke tests before any Secret behavior is enabled.
6. Keep a kill switch that restores the existing plaintext path only in non-production during the
   migration. Production isolated mode must fail closed rather than downgrade silently.

Exit gate: existing Daytona chat, tools, previews, lifecycle timers, mounts, pause/resume, and
cleanup work with no Secret attachment.

## Phase 2: model API keys behind per-sandbox leases

1. Add credential classification for reviewed direct HTTP providers and Azure/custom endpoint API
   keys.
2. Derive a non-empty exact host allowlist from the canonical provider registry or validated custom
   endpoint.
3. Split non-secret configuration from credential values before sandbox creation.
4. Add `DaytonaSecretLease` provisioning and compensation.
5. Pass Secret names through Daytona's `secrets` field and stop copying those values into
   `envVars`.
6. Persist only lease metadata needed for resume and cleanup.
7. Rotate the Daytona Secret on same-binding credential changes.
8. Reject unsupported Bedrock, Vertex service-account, signing, and unknown credential shapes with
   an actionable error.

Exit gate: direct provider and custom endpoint runs succeed, plaintext checks stay clean, and every
normal and failed run leaves no orphan after reconciliation.

## Phase 3: crash-safe lifecycle and janitor

1. Couple Secret cleanup to confirmed sandbox deletion, not turn completion.
2. Retain leases across real pause, stop, archive, and resume.
3. Add a cursor-paginated janitor for Agenta-owned leases.
4. Cover partial Secret creation, failed sandbox creation, failed state persistence, runner crash,
   sandbox auto-delete, deletion retry, and concurrent cleanup.
5. Alert on orphan count, oldest orphan age, reconciliation failures, and Secret API errors without
   logging names or values.

Exit gate: fault-injection tests and a runner-kill live test converge to zero orphan Secrets.

## Phase 4: explicitly declared custom text secrets

1. Repair or replace the missing `POST /secrets/resolve` backend path while preserving project
   authorization and requested-name filtering.
2. Define consumer-scoped destination policy. Do not add a whole-vault export.
3. Support text custom secrets only when the consumer sends the value unchanged over HTTP(S).
4. Reuse the same per-sandbox lease and exact-host rules.
5. Keep MCP and gateway tool secrets server-side when the existing callback plane can do so. Use
   Daytona substitution only when the client truly runs inside Daytona.
6. Reject JSON, signing, file, private-key, and native-protocol uses unless a separate secure
   delivery design exists.

Exit gate: an explicitly requested text secret works against its declared host, is unavailable
elsewhere, and undeclared project secrets never reach Daytona.

## Phase 5: remove compatibility paths and document support

1. Remove the production plaintext fallback for supported Daytona credentials.
2. Document the minimum Daytona control-plane version and required API-key permissions.
3. Document supported and unsupported credential classes.
4. Decide separately whether to migrate or retire the legacy Python Daytona evaluator.
5. Update the broader secret-isolation design: Daytona native substitution is the preferred remote
   path; the Agenta model proxy remains the cross-provider and local-sandbox solution.

## Rollout

Roll out by environment, then by a small percentage of Daytona sessions. Track sandbox creation
latency, authentication failures, proxy substitution errors, cleanup failures, and orphan count.

Do not use a per-run best-effort fallback to plaintext. If Daytona Secret APIs fail, fail the run
before sandbox creation or use an explicitly configured environment-level rollback during the
early migration window.

## Dependencies and coordination

- Coordinate the resolved credential contract with `provider-model-auth` and
  `custom-providers-in-pi`.
- Coordinate provider lifecycle changes with `session-keepalive` and `sandbox-agent-fork`.
- Keep MCP secret delivery aligned with `secret-isolation` and the backend gateway direction.
- Use the repository BUT-LOCK before any GitButler write during implementation.
