# Single-agent loading design

## Context

The existing interface creates an agent and starts a builder conversation. `/m` is the new default app on both desktop and mobile; the older web app is a separate host. Preserve each host's current behavior. See [the proposal](proposal.md) for scope.

The current implementation reference is release/v0.119.0 at `ebb825d1da345e7bf9741e832d7664a972e6f72e`. The branch being reviewed predates parts of this runtime. [The build-kit audit](../../../docs/design/agent-workflows/projects/agent-plugin-templates/build-kit-audit.md) identifies the relevant paths and gaps.

## Goals / Non-Goals

Load known resources in backend code, then let the agent finish ordinary self-configuration. This boundary ends when the first setup message is durably accepted. It does not promise that the model has finished the user's task or activated an automation.

There is no template installation resource with installing/setup/ready states, no direct-run readiness gate, no new setup UI, and no template-specific tool family. Loading multiple agents is unsupported in this version.

## Decisions

### A source belongs to the loading service

Use a typed source reference such as `{"kind":"internal","key":"outbound-prospecting"}`. Existing card keys resolve to this source by default. An internal source resolver returns a bounded package directory, version, and content digest. It accepts registry keys, not arbitrary filesystem paths. The package loader consumes resolved content regardless of source.

Reuse the skill import pattern of a source-fetching interface and resource provenance. Store the template's source, resolved version, and digest as namespaced origin/provenance metadata on the workflow/revision. The exact new metadata discriminator is a template source, not a forged skill origin. Existing agents require no conversion. Git repository and archive adapters are future source implementations, not first-version UI or import features.

### Keep one agent in the current package contract

Retain the flat `agents` map and `entry` key for package addressing, but the first-version schema accepts exactly one agent and no `subagents` field. Each agent has its own name, description, and instructions path. This preserves agent identity without introducing graph creation. The separate future schema and proposal document multi-agent behavior without implying support.

### Compose package content with ordinary creation defaults

Use the same runnable model, harness, and sandbox selection as ordinary agent creation. The package does not select an `llm`. The loading request carries the already resolved creation settings through the same validation path. Add package instructions, skill references, files, and verified connection configuration to those defaults; do not replace unrelated creation settings.

Use existing workflow, skills, and mount services. Copy declared workspace files before handing off. Never execute package startup hooks or copy arbitrary undeclared files. A pure compiler produces native configuration; resource services perform writes.

### Keep MCP references small

An option is `{"kind":"mcp","server":"mail-drafts"}`. The key names a declaration in `mcp.json`; endpoint/authentication data comes from that declaration and existing target-project gateway configuration. Do not repeat credentials or header requirements in the option.

v0.119 supports native HTTP and managed gateway MCP references, including builtin, standard, and custom routes. The gateway supports no-auth, API-key, and OAuth flows. Bind an existing matching endpoint when available. A missing endpoint uses the existing connection/settings flow; do not create a new picker or invent a custom endpoint from a package key. Unresolved requirements go into the first message. Public package URLs never grant network access beyond existing gateway policy.

The verified transport path is Streamable HTTP, including SSE-framed responses. That is not evidence for stdio process execution or the legacy separate SSE transport. Validate transport support separately from authentication support and reject unsupported declarations before resource writes.

### Deliver setup context in the first message

Compose the normal first message from the current seed, the optional `SETUP.md`, optional connection/automation notes, unresolved connection choices, and automation recipes still to configure. Label package text as template-supplied content. Do not add hidden messages, new platform system instructions, or a per-turn installation-context resolver. The agent can read its ordinary saved configuration with the existing build kit.

No schedule or subscription is created merely by loading the package. Recipes are guidance in the first message. The agent later uses existing discovery, connection, configuration, verification, and trigger tools under their existing permission checks.

### Prevent duplicate loading and duplicate first messages without a setup lifecycle

A create request has a stable project-scoped request key and normalized payload fingerprint. Replays return the existing agent/session identifiers; different content under the same key conflicts. Reserve the target workflow identity before writes and reconcile via that identity on retry. Use existing resource identity/provenance facilities; if they cannot atomically claim the request, add a general create-request deduplication primitive in the owning service, not a template installation domain.

The first message uses a deterministic key derived from the created workflow/session and template digest. Its persisted payload and fingerprint must be stable even if the account list later changes. The session input service must atomically claim that key and append or enqueue one input. Concurrent, refreshed, or timed-out calls return the existing input/result. A conflicting payload is rejected. A deduplication receipt is request bookkeeping, not model-visible setup status.

The current queued-input service has key/fingerprint checks, but its idle execute path returns before creating a pending-input record. Full first-message deduplication is therefore a general session-input gap to close and test, not an existing guarantee. Do not claim success based on a browser latch.

### Preserve the interface

Replace the data-loading call under the existing template action. Keep cards, navigation, connection-card placement, Continue/Create semantics, and free-text creation. Existing choices must reach the saved configuration or the first message without being lost or silently replaced. Requirements that the current card cannot display are explained in the normal agent conversation through existing tools. New multi-account or MCP selection screens are out of scope.

## Ownership and code checks

| Owner                          | Responsibility                                                         | Validation                                                                      |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Source resolver                | Resolve bounded package content and provenance.                        | Unknown keys and path escapes fail before writes.                               |
| Loader/compiler                | Validate one-agent content and generate native configuration.          | Pure deterministic tests; no provider calls inside compiler.                    |
| Workflow/skills/mount services | Create resources with project authorization and retry identity.        | Real service tests and resource read-back. No foreign-domain table writes.      |
| Existing creation logic        | Choose runnable model/harness/sandbox.                                 | Package and blank creation resolve the same defaults for the same user/project. |
| MCP gateway                    | Endpoint identity, authentication, network policy, native permissions. | Validate configuration against v0.119 types; reject foreign-project references. |
| Session service                | Persist first message and deduplicate delivery.                        | Concurrent and idle-session replay tests with stable input identifiers.         |
| Existing build kit             | Continue ordinary agent setup after handoff.                           | Tool audit and a smoke run; no new template-specific operations.                |
| Frontend host                  | Existing controls and navigation.                                      | Browser regression on both hosts and viewport sizes.                            |

Authenticate the caller and authorize project and target resources before resolving bindings or writing resources. Backend-derived context never substitutes for authorization. Secret values must not appear in package content, metadata, first messages, logs, or traces.

## Risks / Trade-offs

- A source package can describe setup that needs a missing gateway endpoint. The first message identifies that need and the agent uses current connection/settings affordances. No unsupported configuration is saved.
- Copying files can fail after workflow creation. Reuse the same target on retry, preserve user edits, report the failure through existing error handling, and do not submit the first message until the required copy succeeds.
- The existing UI may not express every package option. First-version bundled templates must fit its existing choices; additional setup belongs in the agent conversation.
- Generic request deduplication needs implementation verification. Keep this as a narrow resource/session service concern, not an installation state machine.

## Deployment

Replace the built-in template content source and its loading handler. Existing agents remain untouched, so there is no customer data migration. Rollback restores the previous built-in loader for new creates; agents already created remain ordinary editable agents. No marketplace, automatic package update, or migration wizard is included.
