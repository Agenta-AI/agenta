# Runner self-hosting cleanup

Status: DESIGNED, awaiting owner review
Date: 2026-07-13
Target branch: `big-agents`

This project makes the agent runner understandable from its deployment configuration alone. It replaces shared and overlapping environment variables with one runner-owned provider contract, removes automatic subscription credential upload, adds explicit bootstrap assets, and makes required mounts fail loudly.

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
- Daytona configuration belongs under the runner namespace. Code-evaluator Daytona configuration is separate.
- The runner never discovers an operator's home directory or automatically uploads Pi or Claude OAuth state.
- Subscription authentication is an explicit local self-hosting setup taught in a tutorial.
- Bootstrap assets are declarative, typed, and implemented by both local and Daytona adapters. Version 1 does not execute arbitrary hooks.
- Remote subscription authentication is unsupported until the relevant provider explicitly approves the integration and Agenta defines a safe product contract.
- Pi installation is detected and repaired by the runtime. There is no deployment-wide "Pi is installed" boolean.
- Durable mounts required by a session or workflow artifact fail the run when they cannot be signed or mounted. Sessionless runs remain ephemeral.
- The runner receives a narrow environment and no static Agenta API key. Per-run caller credentials authorize callbacks and trace export. It does not inherit a shared application environment or database and cryptographic secrets.

## Reading order

- [Context](./context.md) explains today's architecture and why the current variables are confusing.
- [Research](./research.md) records repository evidence and the review of PRs #5274, #5285, and #5286.
- [Interface](./interface.md) defines the target environment, Helm, capability, bootstrap, and failure contracts.
- [Plan](./plan.md) splits the cleanup into reviewable implementation PRs.
- [QA](./qa.md) defines the environment, harness, and credential matrix.
- [Documentation plan](./documentation-plan.md) maps the final public docs through Diátaxis.
- [Open issues](./open-issues.md) parks work that should not block the cleanup.
- [Status](./status.md) is the owner review checklist and progress log.

## In scope

- Runner provider selection and configuration.
- Runner-specific Daytona names and validation.
- Runner-to-Services routing and authentication.
- Declarative bootstrap assets for local and Daytona environments.
- Local subscription setup.
- Removal of automatic Daytona OAuth upload.
- Removal of deployment-wide runtime facts and hidden policy switches.
- Required-mount failure behavior.
- Compose, Helm, Railway, self-hosting docs, and the local 8280 QA deployment.
- Capability discovery needed to keep the API and UI honest.

## Out of scope

- Implementing the Docker or E2B providers.
- Sharing a personal subscription between users or tenants.
- Remote subscription support.
- Arbitrary bootstrap scripts, VPN hooks, or network overlays.
- Reworking code-evaluator execution in the same change.
- Backward-compatible aliases for unpublished pre-production variables.
- A custom-role migration bridge. Default roles and tests still need the final mount permissions.

## Related work

- [PR #5274](https://github.com/Agenta-AI/agenta/pull/5274) added mount and snapshot changes that exposed the immediate configuration bugs.
- [PR #5285](https://github.com/Agenta-AI/agenta/pull/5285) proposes Docker and a sandbox allowlist. This project adopts its capability-based provider direction but replaces the permissive cross-layer allowlist contract.
- [PR #5286](https://github.com/Agenta-AI/agenta/pull/5286) adds useful runner authentication and provider-key narrowing. This project rejects its broad Helm `commonEnv` injection and its compatibility escape hatch.
- [Runner self-hosting explainer](../runner-selfhosting-explainer/README.md) contains the detailed as-built explanation that led to this cleanup.
