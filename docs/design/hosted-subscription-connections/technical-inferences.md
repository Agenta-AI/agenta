# Technical inferences

> Disclaimer: this document contains the AI agent's interpretation of the
> [user requirements](requirements.md). These are proposed technical implications, not additional
> requirements supplied or approved by the user. They may be incomplete or incorrect. They do not
> select an architecture, storage backend, service owner, or harness. The current exploration
> direction is in [working research](working-research.md).

## Proposed implications

| User requirement | Inferred technical outcome | Choices left open |
| --- | --- | --- |
| Sign in from the UI | Agenta needs a way to initiate provider authorization and report whether it completed. | Login protocol, process owner, public endpoints, polling or events, and recovery after leaving the page. |
| Show the subscription in the model list | The picker and execution path need to agree on which subscription and model a selection uses. | Reusing or extending existing connection records, identifiers, and model discovery. |
| Reuse across agents and sessions | Usable authentication needs to outlive an individual run. | Native credential files, a credential service, a database or other persistent storage, and credential delivery. |
| Run sessions in parallel | Authentication renewal must not strand other sessions or lose usable credentials during concurrent activity. | Harness-native coordination, shared storage, a broker, credential injection, or another verified mechanism. No particular refresh lock or single-store layout is required by this outcome. |
| Project or organization scope | Listing and execution need a consistent scope boundary. | Exact scope, membership permissions, who may manage the login, and how the connecting account relates to shared use. |
| Either Codex or Pi is sufficient | Prove the full login, execution, and renewal path for one harness before making both a release condition. | Harness choice and whether the login component is the execution harness. |
| Consider Grok for a later version | Identify ChatGPT-specific decisions that would obstruct adding another subscription provider. | Whether an adapter is useful now; a generic framework is not a first-release requirement. |

Provider usage limits remain an external constraint. The requested parallel use does not by itself
specify throughput, a numerical concurrency target, or behavior when the provider rejects work.

## Assumptions removed from earlier technical requirements

The earlier AI answers mixed required outcomes with candidate solutions. These choices are open:

- **Runner-owned login and main-API-owned records.** Service placement needs evidence about the
  selected login interface and existing infrastructure.
- **One encrypted volume and authentication home per connection.** Filesystem mounts are one
  candidate. Neither a volume nor a dedicated worker or runner per connection is prescribed.
- **One authoritative store, a per-connection lock, and generation numbers.** These describe one
  coordination design. The required outcome is correct concurrent authentication and renewal.
- **Both Codex and Pi, with token conversion between them.** One harness is sufficient. Credential
  interoperability is not a prerequisite.
- **Project scope by default, or a private owner-only connection.** The user permits project or
  organization scope and has not specified membership or management permissions.
- **Interactive-only execution, one account per user, or exclusions for schedules and events.**
  The user has not set these boundaries. Determine whether they matter to the release separately.
- **Mandatory cancel, disconnect, reconnect, page-refresh recovery, and particular status enums.**
  These are lifecycle questions to resolve, not explicit user requirements.
- **A new connection schema, stable ID format, and an immediate provider-adapter abstraction.**
  Existing structures may be sufficient; evaluate them before introducing new ones.
- **Specific encryption, backup, token-delivery, and migration mechanisms.** Credential protection
  and compatibility need design review, but the user's list does not prescribe these mechanisms.

One active run per subscription would contradict the requested parallel use. Preserve that limit
only as a historical v0 choice, not as an option that satisfies the current requirements.

## Candidate validation

A useful acceptance exercise would connect ChatGPT from the UI, select it in two agents, run
concurrent sessions through the chosen harness, and exercise credential renewal while both are
active. It should check what each session actually does with updated credentials. Merely starting
two runs with unexpired access tokens would not establish renewal correctness.

Further fault and permission scenarios depend on the answers in [design questions](design-questions.md).
