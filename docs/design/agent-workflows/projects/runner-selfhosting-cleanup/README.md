# Runner self-hosting cleanup

Status: DESIGNED v2 after owner review round 1, awaiting second-round review
Date: 2026-07-13
Target branch: `big-agents`

This project makes the agent runner understandable from its deployment configuration alone. It replaces shared and overlapping environment variables with one runner-owned provider contract, removes automatic subscription credential upload, and documents explicit operator-owned subscription mounts. A capability endpoint, a bootstrap manifest, and fail-loud mount semantics are deferred open issues, not release work.

## Outcome

A self-hosted operator should be able to answer these questions by reading one Compose service or one Helm values block:

1. Where is the runner?
2. Which sandbox providers can it use?
3. Which provider is the default?
4. Which credentials belong to the runner itself?
5. Which files are intentionally copied into a run?
6. Which combinations of sandbox, harness, and authentication are supported?

The normal deployment uses one runner service. That runner can support both local and Daytona runs at the same time. Harness choice remains per agent. Sandbox choice remains per run, constrained by the providers the operator enabled.

## Decisions

- The runner is a deployment-level service, not one sidecar per harness or sandbox provider.
- The operator enables sandbox providers explicitly. Unset means local only, not every provider known to the binary.
- The enabled-provider list is also the deployment security posture: `daytona` only means no user code ever runs inside the runner container. That is the right posture for any multi-tenant or exposed deployment.
- API and web get provider availability from the same environment value, set once per deployment by the hosting templates. A discovery endpoint is deferred (RSH-7).
- Daytona configuration belongs under the runner namespace. Code-evaluator Daytona configuration is separate.
- The runner never discovers an operator's home directory or automatically uploads Pi or Claude OAuth state.
- Subscription authentication is an explicit local self-hosting setup: a read-only Compose volume mount taught in a tutorial. There is no bootstrap manifest in version 1 (RSH-4).
- Runtime customization (extra binaries, certificates, dependencies) happens through operator-built images and the shipped Daytona snapshot scripts, not runner configuration.
- Remote subscription authentication is unsupported until the relevant provider explicitly approves the integration and Agenta defines a safe product contract.
- Pi installation is detected and repaired by the runtime. There is no deployment-wide "Pi is installed" boolean.
- Mount failure behavior stays best-effort in version 1, with one structured warning when a durable mount degrades. The fail-loud contract is deferred (RSH-11).
- The runner receives a narrow environment and no static Agenta API key. Per-run caller credentials authorize callbacks and trace export. It does not inherit a shared application environment or database and cryptographic secrets.

## Reading order

- [Context](./context.md) explains today's architecture and why the current variables are confusing.
- [Research](./research.md) records repository evidence and the review of PRs #5274, #5285, and #5286.
- [Interface](./interface.md) defines the target environment, Helm, provider-availability, subscription-mount, and failure contracts.
- [Plan](./plan.md) splits the cleanup into reviewable implementation PRs.
- [QA](./qa.md) defines the environment, harness, and credential matrix.
- [Documentation plan](./documentation-plan.md) maps the final public docs through Diátaxis, with per-page dispositions for the existing self-host tree.
- [Open issues](./open-issues.md) parks work that should not block the cleanup.
- [Status](./status.md) is the owner review checklist and progress log.

## In scope

- Runner provider selection and configuration.
- Runner-specific Daytona names and validation.
- Runner-to-Services routing and authentication.
- Local subscription setup through explicit read-only mounts.
- Removal of automatic Daytona OAuth upload.
- Removal of deployment-wide runtime facts and hidden policy switches.
- A structured warning when a durable mount degrades.
- Compose, Helm, Railway, self-hosting docs, a `hosting/README.md` layout map, and the local 8280 QA deployment.
- One shared provider-availability value read by API and runner.

## Out of scope

- Implementing the Docker or E2B providers.
- Sharing a personal subscription between users or tenants.
- Remote subscription support.
- A runner capability-discovery endpoint (RSH-7).
- A declarative bootstrap-asset manifest, scripts, VPN hooks, or network overlays (RSH-4).
- Fail-loud required-mount semantics (RSH-11).
- Reworking code-evaluator execution in the same change.
- Backward-compatible aliases for unpublished pre-production variables.
- A custom-role migration bridge. Default roles and tests still need the final mount permissions.

## Related work

- [PR #5274](https://github.com/Agenta-AI/agenta/pull/5274) added mount and snapshot changes that exposed the immediate configuration bugs.
- [PR #5285](https://github.com/Agenta-AI/agenta/pull/5285) proposes Docker and a sandbox allowlist. This project adopts its capability-based provider direction but replaces the permissive cross-layer allowlist contract.
- [PR #5286](https://github.com/Agenta-AI/agenta/pull/5286) adds useful runner authentication and provider-key narrowing. This project rejects its broad Helm `commonEnv` injection and its compatibility escape hatch.
- [Runner self-hosting explainer](../runner-selfhosting-explainer/README.md) contains the detailed as-built explanation that led to this cleanup.
