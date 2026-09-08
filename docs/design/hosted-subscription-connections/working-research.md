# Working research and implementation

The objective is a working exploratory implementation of hosted ChatGPT subscriptions in Agenta:
UI sign-in, model selection, use across agents and concurrent sessions, credential renewal, and a
UI path back to a usable connection when another login is necessary. Research and implementation
proceed together. A recommendation alone is not the deliverable. The implementation may be rebuilt
when experiments reveal a better approach; straightforward product work should still be written
well and tested through the real application.

[Requirements](requirements.md) contains the user's product requirements.
[Technical inferences](technical-inferences.md) labels earlier AI interpretations.
The original [v0 proposal](v0/README.md) remains historical reference.

## Working direction

Mahmoud's additional direction for this exploration:

- Remove the timebox. Continue building and learning; do not stop after producing a report.
- Explore alternatives in parallel with implementation of the full product flow.
- Prefer letting each session's harness handle refresh. This is a hypothesis to explore, not a
  selected architecture.
- A concurrent refresh failure is acceptable if the session recovers automatically and continues.
  Preventing every race is not a requirement.
- Consider mounted storage, faster ways to share state, database-backed state, and hooks that
  publish or reload changes. A coordination component need not own provider refresh itself.
- Put a single authentication-owning process serving all conversations last among the options.
- Investigate how the UI learns that another login is necessary and how sessions recover afterward.
- Build through one of Codex or Pi; supporting both is optional. Do not implement Grok.
- Choose ordinary schema and integration details pragmatically rather than blocking on a final
  schema design.

The proposals below are the AI agent's working breakdown, not extra user requirements or proven
properties of Codex, Pi, S3, or SeaweedFS. Change them when evidence supports doing so.

## Starting code and terminology

A harness is the coding client, such as Codex or Pi. The runner starts and manages it. A session
holds a conversation; an access token authenticates model requests and a refresh token obtains
replacement credentials. These lifetimes need not coincide.

At the starting PR commit, [the runner manifest](../../../services/runner/package.json) records
Codex 0.145.0 and Pi 0.80.6. Read those versions first and distinguish changes in newer upstream
versions. ChatGPT's server is not the open-source component being inspected; Codex and Pi are.

Current subscription integration uses the operator's native credential files:

- [Codex home assembly](../../../services/runner/src/engines/sandbox_agent/codex-assets.ts) links a
  session's authentication file to the operator mount.
- [Pi setup](../../../services/runner/src/engines/sandbox_agent/pi-assets.ts) uses the mounted Pi
  agent directory directly in subscription mode.
- [Session mounts](../../../services/runner/src/engines/sandbox_agent/mount.ts) use geesefs to
  expose object storage as a filesystem, including inside remote sandboxes.
- [Subscription status](../../../services/runner/src/subscription-status.ts) and its
  [service adapter](../../../services/oss/src/agent/runtime_status.py) are starting points for
  connecting authentication state to product behavior.

Trace the actual cloud storage configuration. The discussion concerns S3-backed mounts in Daytona
and SeaweedFS in the existing setup, not Redis Streams. Separate the storage API, the filesystem
adapter, and local caching when measuring behavior. Do not assume they have identical semantics.

## Parallel work

| Track | Work | Deliverable |
| --- | --- | --- |
| Client authentication | Inspect pinned Codex and Pi source, tests, and official documentation. Run focused experiments. | Source-linked findings plus reproducible login, refresh, reload, and re-login behavior. |
| Shared credential state | Try the existing mount pattern and small alternatives for publishing or retrieving changed credentials. | Runnable variants with concurrent-session results on the relevant storage path. |
| Product implementation | Implement UI sign-in, connection persistence and scope, existing model-picker integration, execution routing, and re-login presentation. | A working application flow integrated with a real harness. |
| Integration and feedback | Combine results, run concurrent agents, inspect failure paths, and incorporate Codex/user feedback. | A working integrated branch, regression coverage, and explicit remaining gaps. |

Use separate files or worktrees for independent experiments. Name an owner for shared product
files in [the communication log](communication-log.md). Provisional interfaces are fine; avoid
building a universal authentication framework to connect the tracks. Keep mocks visibly separate
from the demonstrated real-provider flow.

## Architecture experiments

### Native credentials through a shared mount

Let the session's harness read and update the same native authentication state. Start from the
existing mount behavior. Try natural recovery first: after a refresh failure, reload current state
and retry if another process has published usable credentials. Inspect whether the harness already
does this before adding code.

Validate write visibility across independently mounted workers, cache behavior, whole-file writes,
refresh failure recovery, and long-lived process reload. A local shared-directory result is only a
baseline. Measure the real mount path before choosing cache settings or adding coordination.

### Session-owned refresh with shared state and hooks

Keep refresh in the session but change how it publishes and retrieves credentials. Candidates
include existing database storage, direct object-store reads/writes, or supported credential-store
and change-notification hooks. A notification can tell another session to reload; it need not carry
tokens. Reading current state on demand may remove the need for notifications entirely.

Establish what the harness can actually customize. Compare the smallest usable variant with the
mount baseline. Check that two updates cannot silently leave everyone using obsolete state and
that a refresh result is persisted when it happens, rather than only after the entire run ends.
Do not assume a new service or a database migration is necessary.

### Coordination component when justified

If native sharing is insufficient, try a narrow component that helps sessions publish or reload
credential changes. Distinguish coordination from performing the provider refresh itself. Test a
refresh-owning credential service only if supported interfaces make it useful. Compare the cost of
another process with an implementation inside existing infrastructure.

### One authentication-owning process, last option

Only prioritize this if the simpler candidates show a concrete limitation. It may own one login
while serving concurrent independent conversations, but process lifetime, session multiplexing,
and recovery could add substantial complexity. Do not confuse this candidate with serializing
all model runs, which would not meet the concurrency requirement.

## Questions for source and internet research

For each harness, record the exact version, file/function, upstream URL, and what has been observed:

1. How can Agenta start and observe login from a UI? Which fields and errors are exposed?
2. What credential files are read or written, and what additional session/configuration state
   shares those directories? Can a supported interface override the credential store?
3. What triggers refresh? Is it expiry, a model-request failure, or another condition?
4. What is cached in memory? When does the process reread credentials after external changes?
5. If two processes refresh at once, what does the loser do? Which locks span processes, and what
   filesystem operations do they depend on?
6. How are new credentials written? What happens if writing fails after the provider accepted
   refresh, or the request completes remotely but its response is lost?
7. Which errors distinguish transient failures, stale credentials, revocation, and required login?
8. After a new login, can an existing process recover, or must Agenta recreate it and resume the
   conversation? Can an old process later overwrite the replacement login?
9. What evidence exists for access-token overlap and refresh-token reuse behavior? Label server
   behavior unproven unless supported by provider documentation or a real observation.

Use official docs, source, tests, and relevant upstream issues. Separate documented guarantees,
client implementation behavior, observed provider behavior, and hypotheses. Do not generalize from
new upstream code to Agenta's installed version or from a simulated provider to ChatGPT.

## Re-login and UI behavior

Build a visible path for authentication trouble as part of the prototype. Distinguish ordinary
access-token expiry, recoverable renewal failure, and a connection that needs the user to authorize
again. Avoid asking for another login just because the first refresh attempt failed.

Trace how the runner's result reaches the API and UI. Reuse existing status or error transport when
it fits. Decide pragmatically whether a failed turn can be retried or resumed after reconnect, and
show that behavior in the actual UI. Preserve the agent configuration and conversation. Document
which user can reconnect a project- or organization-scoped subscription and whether replacing the
provider account is allowed. These are working implementation decisions to record, not settled
permissions from the original requirement list.

## Validation and evidence

Run two agents with independent sessions through a real supported harness. Exercise:

- UI login, subscription selection, and successful concurrent model requests.
- Normal access-token renewal and simultaneous renewal attempts.
- Delayed visibility of updated credentials and stale in-memory state.
- A failed refresh followed by successful automatic reload/retry when new credentials exist.
- A worker interruption around renewal, including the difference between a failed request and a
  provider-side success whose response or persistence is lost.
- Actual required re-login, UI notification, completion of new login, and subsequent session use.
- Existing mount-based subscriptions and ordinary model connections affected by the implementation.

Use controlled provider responses for repeatable fault coverage and real credentials for validating
the provider path. Do not claim a mocked test proves provider rotation or revocation semantics.
Read current credential accessibility and project/tenant permissions before introducing new
boundaries; test concrete access paths affected by the chosen implementation.

Keep tokens and raw credential files out of evidence. Record versions, storage configuration,
commands, sanitized event timelines, outcomes, and commit references. Mark each scenario as passed,
failed, or not established. A scenario without real credentials remains not established even if a
mock passes. Human provider authorization may require Mahmoud; ask for that step while other tracks
continue.

## Completion

Deliver a runnable integrated application with UI login, model selection, concurrent agent use,
refresh recovery, and re-login handling through at least one harness. Include repeatable tests,
setup/run instructions, and known limitations. Keep useful competing experiments reproducible so
we can change direction without repeating the research. A preferred architecture and explanation
accompany the implementation; they do not replace it. Grok and a production rollout are not part of
this exploratory handoff.
