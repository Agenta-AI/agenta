# Loading and first-message handoff

## Flow

1. The user opens a template through the existing interface. The same action supplies an internal source key to the loading service. No new package preview or setup screen is added.
2. Authorize the caller's project access. Resolve and validate the source package, including its one-agent limit, references, and safe paths, before resource writes.
3. Apply the existing model/harness/sandbox selection. Create the ordinary agent with its name, description, and permanent instructions. Install skills and copy declared files and folders through their existing services.
4. Preserve the current connection step and its timing. `/m` is the default app on desktop and mobile; its card remains in the session. The older web host retains its current pre-create behavior. Valid choices become ordinary configuration or remaining setup context.
5. Compose the normal first message with the optional setup instructions, existing user choices, unresolved connections, and automation recipes. Submit it once to the created agent's session.
6. End the loader's responsibility when that message is durably accepted. The ordinary agent conversation handles the rest with the current build kit.

See [the step-by-step build-kit audit](build-kit-audit.md) for how the agent handles every later action. There is no installation resource, no setup status, no template-specific operation, and no readiness gate for ordinary runs.

## First message

A concrete first message could be:

```text
Hi Outbound Prospecting. Please set yourself up.

Template-provided setup instructions:
Ask for the target customer profile and update target-profile.md.
Prepare one sourced research example and an outreach draft. Do not send it.

Choices already made:
The user skipped mailbox access. Save drafts as files.

Remaining setup:
Offer a weekday schedule after the user approves the example.
Confirm its time and timezone, then use the existing schedule tool if approved.
```

The saved configuration already tells the agent which skills and tools it has. Reading it with `read_config` is normal self-configuration, not a separate installation-state read. Do not add a `SessionContext` extension, hidden message type, or repeated setup-context injection for this feature. Do not put secrets in the message.

## Retry contract

A stable create key is scoped to the authenticated project and bound to a normalized request fingerprint. Claim the request and target identity atomically through the resource service. Same-key/same-payload retries return the same agent and session; different payloads conflict. Copy retries preserve files that the user changed.

First-message delivery has a separate session-scoped key derived from the created workflow/session and package digest. Persist its original payload and fingerprint. Claim and append/enqueue the input atomically in the session service. Timeout, reconnect, refresh, and two-tab submissions return the existing input/result. They do not append another greeting or rebuild the message from a newly changed account list.

This is ordinary request deduplication. It does not track whether the agent completed setup. v0.119's queued-input path has idempotency checks, but its idle path needs explicit coverage and likely a general service enhancement. See [the design](../../../../../openspec/changes/load-single-agent-templates/design.md). Do not claim once-only delivery until the idle and concurrent cases pass.

## Resource ownership

The loader resolves source data and calls existing services. The compiler transforms validated data without side effects. Workflow, skill, mount, gateway, and session services retain authorization and storage ownership. Do not write directly into another domain's tables.

Check caller/project access before resolving any project connection, secret, workflow, or mount. Being given trusted context does not authorize a write. The normal build kit retains its existing self-configuration and external-action permissions after handoff.
