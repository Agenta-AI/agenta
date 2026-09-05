# Simplification review

The desired outcome is that an agent can request a credential, the user configures it
once, and the same conversation continues with the credential available. The following
suggestions are incorporated in the plan.

## One readable delivery mode first

**Suggestion (non-blocking):** defer hidden delivery and host controls to milestone two.
This removes policy storage, a mode selector, host validation, custom Daytona Secret
allocation, and their combinations from the first implementation. Users give up host
enforcement and protection against a process reading the value. Shared instructions
reduce accidental exposure but do not replace those controls.

Keep explicit typed credentials and bindings now. Those inexpensive boundaries let later
policy resolution choose the transport without changing how an agent selects a secret.

## One form and one saved binding list

**Suggestion (non-blocking):** settings and the request card share the same attachment
flow and ordinary agent revisions. Do not add session-scoped grants, a second attachment
table, or per-skill secret collections. Users give up temporary one-conversation bindings;
an attachment persists on the selected agent variant until removed. The UI must say so.

Reuse the existing secret form instead of copying it. Keep the request tool distinct from
OAuth connection setup because their inputs and completion conditions differ. Share the
client-tool interaction mechanism, not the OAuth-specific controller.

## Resume is the application boundary

**Suggestion (non-blocking):** resolve and apply credentials in the next run, before the
harness continues. Remove the proposed need for a separate apply endpoint, readiness poll,
or browser-owned "injected" flag. The tool result reports configured state; runtime
success is established by the existing run pipeline.

This keeps one owner for runtime changes and handles runner restarts without another
coordinator. A failed resume becomes a visible run error with normal retry, not a second
secret-creation attempt.

## Recover partial saves without a transaction framework

**Suggestion (non-blocking):** preserve a successfully created vault entry if attaching it
fails. Re-read the unique slug and current agent revision before retrying. Reuse existing
revision conflicts and interaction identity. Remove distributed rollback, automatic vault
delete, new durable setup records, and competing retry loops.

The tradeoff is visible partial completion: the user may see "Saved in vault; not attached"
and need to retry attachment. That is less work than re-entering a lost credential and
avoids deleting a secret another consumer might already use.

## Use existing restart behavior before live environment patching

**Suggestion (non-blocking):** permit a supported reopen/rebuild at the next run boundary
when process environments cannot update live. Preserve the conversation and durable files,
but do not promise uninterrupted subprocesses. Add live patching only if measured restart
cost or a concrete workflow makes this limitation unacceptable.

Validation, runtime authorization, collision protection, redaction, cancellation, and
no-stale-credential execution stay in the first milestone. Removing them would shift
routine failures and recovery work onto the user.
