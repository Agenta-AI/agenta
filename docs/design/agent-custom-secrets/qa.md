# Acceptance checks

These checks define the release target. Validation is partial and uses dummy credentials without
printing secret values.

## Validation snapshot

- The real desktop flow passed request, cancellation, create, attach, revision adoption, resume in
  the same session, and a SHA-256 side effect using a fixed dummy value. Cancellation settled once
  and did not repeat the request. See [browser evidence](qa-browser-evidence.md).
- The Advanced flow passed create with a default, attachment override, edit, removal, refresh, and
  revision adoption. Its forced partial-save retry passed with one vault create across two commit attempts. The dirty-draft guard and failed-removal retry also passed in the browser.
- Failed-resume recovery passed after an injected HTTP 503. The ordinary turn retry reused the
  saved revision; a repeated request used Continue without another vault create or revision commit.
- Local Pi passed the live S1 injection, rotation, removal, continuity, and no-plaintext checks.
- Daytona reached the live endpoint but could not run because the disposable project had no usable
  OpenAI credential. This is not a passing Daytona result.
- The full Pi, Claude, and Codex matrix across local and Daytona has not run.


## Configuration and permissions

- Select an existing text secret and create a new one through the same drawer. Both save
  the expected binding on the named agent variant. JSON entries cannot be attached.
- Invalid, reserved, duplicate, or colliding variables fail clearly. Existing model/MCP
  environment owners retain their values and policies.
- Missing, deleted, wrong-project, wrong-kind, empty, and unreadable secrets fail before
  harness execution. API writes enforce the same permission rule as the editor.
- A moved `base_revision_id` produces a conflict without overwriting another edit. Retry
  confirms the selected binding against the current revision.

## Card completion and recovery

- Request a secret, configure it, and resume the same conversation. The resumed request
  uses the committed revision, and an authentication test proves the process received it.
- Cancel or decline the card. It settles once and the agent does not automatically repeat
  the same request. Duplicate clicks and dock/inline renders do not double-settle.
- Reload after secret creation, after binding commit, and after settlement. Each case
  resumes from the persisted vault/revision/interaction state without duplicate creation.
- Lose each save response and retry. Existing slug and exact binding checks recover the
  completed write without overwriting unrelated state.
- Switch agents while the card is open. It still targets the originating agent/variant.
- Fail runtime resolution or application after successful configuration. No next model
  turn executes with stale credentials; ordinary retry uses the already-saved binding.

## Runtime and guidance

Run the critical flow on Pi, Claude, and Codex with both local and Daytona environments.
For each, cover a fresh run, a previously warm conversation, value rotation, replacement,
and removal. Verify the conversation and durable files survive any reopen/rebuild, and
old values no longer exist in processes used for the next execution.

Verify two independent runs never inherit each other's custom credential bindings. Local
execution keeps its existing host isolation limits; this test checks injection ownership,
not protection against deliberate host inspection.

Verify the new guidance reaches fresh environments and environments upgraded before the
feature is enabled. Check presence in the delivered instruction channel, and separately
exercise a model request that would otherwise print credentials. Model behavior is useful
QA evidence but is not proof of a security boundary.

Check traces, tool arguments/results, validation failures, analytics, saved diagnostics,
and browser persistence for raw values. Injection travels as credential material over the
protected internal transport; redact diagnostic copies of that request.

Known-value redaction ignores values shorter than four characters to avoid replacing common
text throughout model output. Include a one-to-three-character dummy value in QA and record
that limitation rather than treating redaction as a complete confidentiality boundary. Readable
environment delivery also cannot prevent a sandbox process from transforming or encoding a
value before output. Guidance and redaction reduce accidental disclosure; host-restricted
delivery is the stronger boundary planned for milestone two.

## Supported hosts and regressions

Desktop OSS/EE can configure and fulfill the card. Mobile either fulfills the same flow or
does not advertise the tool. Headless clients can run saved bindings without becoming stuck
on an unsupported browser interaction. Regress existing MCP secret selection/creation,
write-only vault reads, connection cards, and permission approvals.

Use the repository's SDK, service, runner, and frontend test suites for these behaviors,
then the agent release gate for live wire assertions. A green unit suite does not complete
the harness/backend matrix.

## Milestone-two additions

Verify hidden placeholders cannot authenticate at an unlisted host, can authenticate at
an exact permitted HTTPS host, and never fall back after policy or allocation failures.
Reject hidden policy locally. Check policy/value changes at the next run boundary and
cleanup using the existing Daytona resource lifecycle. An echo endpoint alone is not proof
of failed substitution because Daytona can scrub credential values in responses.
