# Single-agent loading design

## Context

The existing interface creates an agent and starts a builder conversation. `/m` is the new default app on both desktop and mobile; the older web app is a separate host. Preserve each host's current behavior. See [the proposal](proposal.md) for scope.

The current implementation reference is release/v0.119.0 at `ebb825d1da345e7bf9741e832d7664a972e6f72e`. The branch being reviewed predates parts of this runtime. [The build-kit audit](../../../docs/design/agent-workflows/projects/agent-plugin-templates/build-kit-audit.md) identifies the relevant paths and gaps.

## Goals / Non-Goals

Load known resources in backend code, then let the agent finish ordinary self-configuration. This boundary ends when the first setup message is durably accepted. It does not promise that the model has finished the user's task or activated an automation.

There is no template installation resource with installing/setup/ready states, no direct-run readiness gate, no new setup UI, and no template-specific tool family. Loading multiple agents is unsupported in this version.

## Decisions

### A source belongs to the loading service

The loading service resolves a template key to a verified package. It returns the package files, version, and content digest. The loader then creates the agent from the resolved package. Agenta records this source information on the created workflow and initial revision. The first version supports only templates from Agenta's internal registry. Existing agents do not require changes.

A card supplies a typed registry reference:

```json
{ "kind": "internal", "key": "outbound-prospecting" }
```

The resolver accepts that key, not a filesystem path. A retry can also supply the stored version and digest to reopen the same package snapshot after the catalog changes. The package loader consumes the resolved content and does not depend on how the resolver found it.

Store the source under the protected platform metadata namespace:

```json
{
  "_ag": {
    "template_origin": {
      "kind": "internal",
      "key": "outbound-prospecting",
      "version": "1.0.0",
      "digest": "sha256:..."
    }
  }
}
```

This follows the skill import pattern of separate source resolution and trusted provenance. It uses a template-specific discriminator. It does not claim to be skill provenance. Git repository and archive resolvers are future adapters, not first-version UI or import features.

### Backend service contracts

Keep transport, pure transformation, and resource writes separate.

| Service                   | Input                                                                                      | Output                                                                         | Side effects                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `TemplateSourceResolver`  | Typed source and optional stored pin.                                                      | Bounded package root, version, and digest.                                     | Reads the internal catalog only.                                   |
| `TemplatePackageParser`   | Resolved package.                                                                          | One validated agent, skills, workspace entries, MCP declarations, and recipes. | None.                                                              |
| `TemplateBindingResolver` | Parsed requirements, user choices, and project id.                                         | Native tool/MCP entries and unresolved needs.                                  | Reads project connections and endpoints.                           |
| `TemplateCompiler`        | Base revision, package, planned deterministic skill references, and bindings.              | Native workflow revision data.                                                 | None.                                                              |
| `AgentTemplateLoader`     | Authorized project/user context, request key, source, base revision, message, and choices. | Workflow, revision, input, session, and execution ids.                         | Calls the owning services in order.                                |
| `SessionInputsService`    | Full invocation payload, stable key, and deterministic execution id.                       | One promoted input with a stable payload fingerprint.                          | Atomically claims the original input in the existing inputs table. |
| `SessionStartsService`    | Exact revision, first message, and stable request key.                                     | Confirmed input and session execution identities.                              | Starts one detached run and confirms its durable row.              |

The public request supplies the source reference, the same base revision data used by ordinary creation, the current initial message, connection choices, and an `Idempotency-Key` header. It cannot supply source provenance, workflow ids, session ids, execution ids, resolved connection slugs, trusted metadata, or credentials.

The loader performs this sequence:

1. The router checks `EDIT_WORKFLOWS` and `RUN_SESSIONS` before source or project-resource reads.
2. The loader checks the deterministic target workflow and request fingerprint. A replay reads its stored source pin.
3. The resolver and parser validate the complete package before writes.
4. The binding resolver re-reads active, valid target-project connections and MCP endpoints.
5. The skills service derives deterministic skill references without writing. The compiler uses them to produce and validate native agent configuration from the package and ordinary creation defaults.
6. After preflight passes, the workflow service creates or resumes the agent with protected template provenance. This first durable write pins recovery to the resolved package.
7. The loader creates or resumes the declared skill workflows and verifies their deterministic references.
8. The mount service creates missing declared paths without replacing existing paths.
9. The session input service atomically claims and fingerprints the full first-message invocation. The session start service binds it to deterministic session and execution ids, starts the exact revision, and confirms the durable execution row.
10. The route returns the same identifiers on a same-key replay.

The detailed file-by-file and test-first sequence is in [the implementation plan](../../../docs/superpowers/plans/2026-09-20-load-single-agent-templates.md).

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

### Message display contract

The agent service prepares the complete user-level execution content before calling the runner. It includes the user's request and labeled template setup guidance in that content. It also supplies optional `display_content` with the original visible request. The runner has no template-specific setup logic. It preserves this generic field when writing the user-message record. Conversation reconstruction uses the full execution content.

The same display rule applies to pending frontend messages, saved records, refresh, and copy actions:

| Field state                   | Normal chat behavior                                    |
| ----------------------------- | ------------------------------------------------------- |
| `display_content` absent      | Show the ordinary message content.                      |
| `display_content` is a string | Show that string, including an explicitly empty string. |
| `display_content` is `null`   | Hide the whole message from normal chat.                |

Field presence must survive Python parsing, serialization, Vercel conversion, runner transport, and record persistence. A missing optional value must not be serialized as explicit null. Display content never replaces execution content in model input or server-side history. Attachments keep their ordinary behavior when a text override is present; explicit null hides the whole chat message, including attachments. Authorized execution records retain the complete input.

The frontend already knows the original request when it creates a pending template message. It uses that request for display before backend records arrive. Pending and durable versions must reconcile through stable input/execution/message identity, never a text comparison, because their execution text can differ. The transition must not duplicate the turn or briefly expose setup guidance. Edit and resend paths must keep the execution content separate from the text shown in the editor.

This contract does not add top-level `setup_context` to SDK or runner message types. Template setup composition belongs to the agent service. No model-adapter setup concatenation is needed.

The first UI invocation must receive the same runtime additions as ordinary UI creation, including tools, skills, permission settings, and disabled-operation preferences. Compose them with the compiled package configuration for invocation only. Do not persist UI-only additions into the agent. Reuse the ordinary capability definitions and merge contract so future UI additions do not require a second template tool list. Non-UI runs keep their existing behavior.

No schedule or subscription is created merely by loading the package. Recipes are guidance in the first message. The agent later uses existing discovery, connection, configuration, verification, and trigger tools under their existing permission checks.

### Prevent duplicate loading and duplicate first messages without a setup lifecycle

A create request has a stable project-scoped request key and normalized payload fingerprint. Replays return the existing agent/session identifiers; different content under the same key conflicts. Reserve the target workflow identity before writes and reconcile via that identity on retry. Use existing resource identity/provenance facilities; if they cannot atomically claim the request, add a general create-request deduplication primitive in the owning service, not a template installation domain.

The first message uses deterministic session and execution ids derived from the project and request key. Before invocation, the general session input service claims the complete request payload in the existing `session_inputs` table, stores its fingerprint, and promotes it to the deterministic execution id. A replay returns that input. Different content under the same key conflicts.

The general session start service then checks the execution row, starts the exact workflow revision in detached mode only when the row is absent, and returns only after the row is durable. Concurrent, refreshed, or timed-out calls return the existing input and execution. This request bookkeeping is not model-visible setup status.

The current queued-input idle path returns `execute` before creating a pending-input record. The implementation therefore does not use that path as durable acceptance. It adds the general claim method to the same owning input service and tests both the input fingerprint and execution identity. A browser latch remains only a user-interface guard.

### Preserve the interface

Replace the data-loading call under the existing template action. Keep cards, navigation, connection-card placement, Continue/Create semantics, and free-text creation. Existing choices must reach the saved configuration or the first message without being lost or silently replaced. Requirements that the current card cannot display are explained in the normal agent conversation through existing tools. New multi-account or MCP selection screens are out of scope.

## Ownership and code checks

| Owner                          | Responsibility                                                                         | Validation                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Source resolver                | Resolve bounded package content and provenance.                                        | Unknown keys and path escapes fail before writes.                                                |
| Loader/compiler                | Validate one-agent content and generate native configuration.                          | Pure deterministic tests; no provider calls inside compiler.                                     |
| Workflow/skills/mount services | Create resources with project authorization and retry identity.                        | Real service tests and resource read-back. No foreign-domain table writes.                       |
| Existing creation logic        | Choose runnable model/harness/sandbox.                                                 | Package and blank creation resolve the same defaults for the same user/project.                  |
| MCP gateway                    | Endpoint identity, authentication, network policy, native permissions.                 | Validate configuration against v0.119 types; reject foreign-project references.                  |
| Session input/start services   | Claim one fingerprinted message, start it once, and confirm its durable execution row. | Concurrent, changed-message, timeout, and idle replay tests with stable input and execution ids. |
| Existing build kit             | Continue ordinary agent setup after handoff.                                           | Tool audit and a smoke run; no new template-specific operations.                                 |
| Frontend host                  | Existing controls and navigation.                                                      | Browser regression on both hosts and viewport sizes.                                             |

Authenticate the caller and authorize project and target resources before resolving bindings or writing resources. Backend-derived context never substitutes for authorization. Secret values must not appear in package content, metadata, first messages, logs, or traces.

## Risks / Trade-offs

- A source package can describe setup that needs a missing gateway endpoint. The first message identifies that need and the agent uses current connection/settings affordances. No unsupported configuration is saved.
- Copying files can fail after workflow creation. Reuse the same target on retry, preserve user edits, report the failure through existing error handling, and do not submit the first message until the required copy succeeds.
- The existing UI may not express every package option. First-version bundled templates must fit its existing choices; additional setup belongs in the agent conversation.
- Generic request deduplication needs implementation verification. Keep this as a narrow resource/session service concern, not an installation state machine.

## Deployment

Replace the built-in template content source and its loading handler. Existing agents remain untouched, so there is no customer data migration. Rollback restores the previous built-in loader for new creates; agents already created remain ordinary editable agents. No marketplace, automatic package update, or migration wizard is included.
