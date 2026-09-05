# Implementation plan

## Milestone one: readable custom secrets and setup cards

### Bind, resolve, and inject

Add the contract in [contracts.md](contracts.md) to the agent template, schema inspection,
configuration validation, SDK parsing, and internal run wire. Resolve text values through
the existing project-scoped runtime vault path. Write-only values require the existing
runtime `secret-resolve` grant; do not relax public vault reads or put that grant in the
browser or sandbox.

Add custom credentials to runner redaction and collision checks before environment
composition. Inject only selected values into the target environment. Support local
and Daytona without changing existing model/MCP credential policy or using a global
`os.environ` mutation in a shared worker.

Include the shared platform instructions in this implementation, using #6365's module.
Keep stable behavior rules there. Obtain the current attached variable names from current
configuration metadata, rather than depending on a generated list that can become stale.

### Add one attachment flow

Reuse the existing text secret form and vault mutations in a shared attachment drawer.
The user selects an existing text secret or creates one, chooses the variable name, and
sees the readable-delivery explanation before saving. Settings and the agent request
card enter this same flow. Existing JSON vault storage stays supported elsewhere.

The shared secret UI belongs in `@agenta/entity-ui`; vault and workflow data operations
belong in `@agenta/entities`. The playground owns the run target and resume orchestration.
Pass that capability into the shared UI rather than importing playground state from it.
Register the interaction in the existing shared client-tool registry and chat rendering.
Do not copy the connection dock's state machine or create another polling service.

Save attachments as an ordinary agent revision through the existing commit operation
with `base_revision_id`. This publishes configuration on that agent variant, not a new
production deployment. The form must name the agent/variant being changed. It must not
silently include unrelated unsaved editor changes: require the user to save or discard
those edits through the existing editor flow before attachment.

### Complete the request card and resume

Example: an agent needs `GITHUB_TOKEN` while processing a repository request.

1. The agent calls `request_secret` with a name, proposed variable, and reason. The
   runner emits the existing client-tool interaction and ends the turn paused.
2. The host displays a pending card with Configure and Cancel actions. Configure opens
   the attachment drawer for the originating agent/variant, even if the user switches
   the editor selection. Navigation never changes which agent receives the binding.
3. The user chooses an existing secret or creates a text secret. A successful create
   returns its reference. Clear raw form content after submission or dismissal; do not
   store it in local storage, conversation state, analytics, or interaction records.
4. Save the binding through the existing revision commit with the revision the form read.
   A concurrent edit produces the existing conflict response. Refresh and ask the user
   to review the attachment again; do not overwrite newer configuration.
5. Read the committed revision into the host's run configuration. Only then settle the
   original tool call once with `status: configured`, the reference, and revision ID.
   Use the existing interaction identity and settlement mechanism for duplicate clicks
   and multiple mounted views. The browser reports saved configuration, not runtime readiness.
6. The existing automatic-resume path submits the same conversation/session with the
   committed revision. It must not reuse an old draft or a pinned previous revision.
   The backend validates that revision in the authenticated project and resolves its
   bindings again; it never trusts a value or arbitrary target from the tool result.
7. Before the next harness turn, reconcile the environment with the new binding set.
   If applying credentials fails, end with a visible runtime error and keep the saved
   configuration. Do not let the model continue under the old environment.
8. After successful application, deliver the pending tool result and continue the same
   conversation. The model can use `GITHUB_TOKEN` without seeing its value in the result.

No separate "apply secret" API or frontend polling loop is required. The existing next
run request is the runtime application boundary. If the host cannot submit the updated
revision, report that limitation instead of claiming the attachment is ready.

### Recover interrupted setup

| Interruption                                   | Required behavior                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User cancels before saving a binding           | Settle cancellation once. No automatic repeated request for the same declined need.                                                                             |
| Secret creation succeeds, binding commit fails | Keep the saved vault entry and show "Saved in vault; not attached". Retry attachment using its reference, without creating again.                               |
| Create response is lost                        | Check the intended unique slug in the current project before retrying. Let the user select the resulting entry; do not overwrite it automatically.              |
| Binding commit response is lost                | Read current revision. If the exact binding is present, use it; otherwise retry from the current revision with user confirmation on conflict.                   |
| Browser reloads before settlement              | Recover the pending interaction from existing session state, read the saved binding, and offer Continue if configured. Never recreate the secret automatically. |
| Resume request fails after settlement          | Keep the configured result and expose the existing run retry. Retry the same saved revision, without another create/attach transaction.                         |
| Runtime resolution or application fails        | Stop before model execution. Show a safe error; retry or edit the saved binding.                                                                                |

The vault entry and agent revision are separate resources. Do not add a distributed
transaction or automatically delete a successfully created secret after an attachment
failure; another consumer may already use it.

### Apply changes between turns

Resolve configured values on each run boundary. Reuse the runner's existing credential
change tracking and session reconciliation. Add, replace, remove, and value rotation must
all take effect before the next execution. Removed or replaced values must not survive in
reused daemon or child-process environments.

For milestone one, choose correctness over a new live-patching mechanism: use the existing
supported reopen/rebuild path when a process cannot update its environment. Preserve the
session ID, conversation, and durable files. Changes may restart running processes and
lose transient process state; show that consequence in configuration UI. Do not mutate
credentials in the middle of an active turn. A request already executing finishes under
its original binding set; this version promises updates at the next run boundary.

Implementation must prove environment refresh and transcript continuity separately for
Pi, Claude, and Codex on local and Daytona. If a backend cannot satisfy both, block that
configuration explicitly rather than silently executing stale credentials. No new session
lifecycle engine is part of this plan.

## Milestone two: host-restricted delivery

Extend the vault with readable or hidden HTTP delivery policy and normalized exact HTTPS
hosts. Keep agent attachments as references plus bindings; policy remains on the secret.

Add hidden custom credentials to the existing Daytona Secret allocation and cleanup
mechanism. Cover exact-host substitution, no plaintext fallback, local rejection of hidden
policy, and policy changes before execution. Carry forward #5703's host-validation and
rotation requirements. Existing readable attachments keep that meaning until an explicit
policy change. A policy change that makes a running configuration unsupported must fail
closed at the next run boundary.

## Implementation order and review

1. Finish and land #6365, or implement on a child branch based on its reviewed head.
2. Add the milestone-one bindings, validation, resolution, runner handling, and shared
   guidance together with contract and runtime tests.
3. Add the shared drawer, persisted attachment flow, and request tool. Validate the full
   interrupted setup and resume cases before enabling the tool.
4. Run [QA](qa.md) against the complete feature on an internal deployment.
5. Design the exact vault policy changes for milestone two after the readable flow works.

The current PR contains the plan only. It does not implement the prompt text or the tool,
and it must not close #5703 as completed work.
