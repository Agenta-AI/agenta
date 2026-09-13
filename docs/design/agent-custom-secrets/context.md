# Context and scope

## Current behavior

Settings stores text and flat JSON custom secrets with stable project slugs. HTTP MCP
configuration can reference a text secret, and its setup drawer can create one. These
features do not provide a general environment-variable attachment for shell commands
or skills. A user who saves a GitHub token still cannot make it available as
`GITHUB_TOKEN` to such an agent through a supported attachment flow.

The runner already distinguishes credential values from normal configuration and
hides model and HTTP MCP credentials through Daytona Secrets. The missing custom
consumer must not repurpose those model or MCP fields.

## Milestone one: internal readable delivery

An authorized user selects or creates a text secret, assigns its environment-variable
name, and saves the binding on the agent. The backend resolves selected values and the
runner injects them into that agent's environment. An agent can request a missing
credential through a card that opens the same attachment flow.

The user sees: "This secret is available to the agent's scripts and shell commands."
The value goes directly from the secret form to the vault API, never through chat or
the tool result. Shared platform guidance tells the model to use credentials without
inspecting or exposing their values. This is behavioral guidance, not host enforcement
or a claim that the process cannot read the value.

Milestone one includes local and Daytona delivery, the existing supported Pi, Claude,
and Codex harnesses, save-and-resume correctness, removal and rotation behavior,
redaction, validation, and permission checks. Start rollout on an internal deployment.
Do not weaken existing model/MCP hiding or add an unrelated public rollout flag.

The desktop agent editor and its chat request card are the first UI surfaces. Shared
components must support OSS and EE. If mobile can receive the new interaction, it must
render the same action flow or explicitly keep the tool unavailable there; a paused
card with no action is not supported. Headless runs can use preconfigured bindings but
must not advertise a browser-only setup tool without an interaction handler.

## Milestone two: host-restricted delivery policy

Add a vault-owned policy for readable use or hidden HTTP delivery with exact allowed
HTTPS hosts. An agent author cannot widen that policy. Daytona creates placeholders
for hidden credentials and substitutes values only at permitted destinations. Hidden
credentials must never fall back to readable delivery. Local execution must reject a
hidden-only binding with a clear explanation.

Specify normalization, disallowed hosts and URL forms, policy-change reconciliation,
and hidden-delivery verification in this milestone. Preserve milestone-one bindings
as explicitly readable; do not silently change their delivery when upgrading.

## Exclusions

Neither milestone commits to JSON expansion, secret files, per-skill permissions,
a generic secret-manager plugin interface, or a new durable cleanup service. Durable
Daytona resource reconciliation remains [#6438](https://github.com/Agenta-AI/agenta/issues/6438).
The existing vault and agent revision stores are sufficient for milestone one.
