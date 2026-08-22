# Open questions

Six calls that need the owner. Each one lists what happens if no answer comes, so nothing in
`plan.md` is blocked on this file.

---

## 1. Is the scoped trace-ingest token wanted for anything other than the sandbox?

`plan.md` step 5 deletes `TRACE_INGEST_SCOPE`, the `_SCOPE_ALLOWED_PATHS` enforcement, and the
`telemetry_credentials` field on the `/access/permissions/check` response. It also deletes the
generic `scope` claim machinery on `sign_secret_token`, because nothing else uses it.

That machinery has a plausible second customer this design does not serve: a user's own process
exporting spans to Agenta with a token that can do nothing else. Today such a user needs a full
API key.

**Options.** Delete all of it and rebuild later if that customer appears. Or delete the sandbox
usage and keep the scope machinery dormant.

**Recommendation, and the default if no answer comes.** Delete all of it. Dormant auth machinery
is the kind of thing that gets wired to something years later by someone who did not read why it
exists. Rebuilding a path-confined token is a day of work if the need is real.

---

## 2. Is the legacy SDK Daytona runner still a live path?

This design makes "no Agenta credential enters a sandbox" true for the runner-driven path. It is
not true everywhere. `sdks/python/agenta/sdk/engines/running/runners/daytona.py` injects
`AGENTA_CREDENTIALS`, the caller's full `Secret ...` token, directly into a sandbox's environment
variables. That token can carry the `secret-resolve` grant, and it can be renewed indefinitely by
anything holding it.

That is a materially worse exposure than the 0600 file this design removes, and it sits in an
environment variable, which is the exact shape `services/runner/src/engines/sandbox_agent/pi-assets.ts`
argues against.

**Options.** Confirm the path is dead and delete it. Or treat it as live and give it its own
design.

**Recommendation, and the default if no answer comes.** Treat it as live until someone confirms
otherwise, and file it as its own issue rather than widening this one. The security claim in
`README.md` is already scoped to the runner-driven path, so nothing here overstates.

---

## 3. Should the run credential stop riding the telemetry block on the wire?

`runCredential(request)` reads the caller's general Agenta credential out of
`telemetry.exporters.otlp.headers.authorization`
(`services/runner/src/engines/sandbox_agent/runtime-policy.ts:10-17`). That field claims to be an
OTLP exporter header. It is actually the credential the runner uses for session claims, mount
signing, the turns ledger, and record ingest. The name says routing and telemetry. The value is
identity.

`README.md` lists this as a non-goal, because fixing it means changing the `/run` wire, which
means the golden fixtures, `protocol.ts`, `wire.py`, and both contract tests, and it does not help
the problem this design solves.

**Options.** Leave it. Or add a top-level `credential` field to `AgentRunRequest`, read from both
for one release, then drop the old read.

**Recommendation, and the default if no answer comes.** Leave it, and file the migration. After
step 4 the telemetry block has exactly one remaining job, carrying the credential, which makes the
naming worse, not better. That argues for doing it soon, but not inside this change.

---

## 4. Are the record budgets set at the right numbers?

`design.md` proposes 262144 bytes per record and 5000 records per turn. Both are guesses. The
per-record number needs to hold one `chat` record with a full model context, and a 200k token
context serializes to well over 256 KB, so the default will truncate content on large-context
runs.

**What would settle it.** Capture the record file from three real turns: a short chat turn, a
long coding turn with a large context, and a turn with several hundred tool calls. Set both
numbers from the measurements before step 4 ships.

**Recommendation, and the default if no answer comes.** Ship the numbers above, and treat the
`ag.meta.trace.records.truncated` counter as the signal. If it is non-zero on ordinary runs, the
number is wrong and the counter will say so.

---

## 5. Does the operator switch earn its place?

`plan.md` adds `AGENTA_RUNNER_SPAN_SOURCE` so a tracing regression in production is a restart
rather than a redeploy, and proposes removing it one release later.

The argument against: it is a second code path that has to keep working, and the ACP-derived
tracer is the fallback, which means the fallback is a strictly worse trace rather than a correct
one. A revert is not much slower and is unambiguous.

**Recommendation, and the default if no answer comes.** Keep it for one release. The runner is
deployed in customer environments where a redeploy is not ours to schedule, and a thin trace beats
no trace.

---

## 6. Should Claude Code and Codex start emitting records now, or later?

The record contract is harness-agnostic on purpose. Claude Code has a hook API and Codex has a
plugin surface, so either could write the same lines and gain the observed model call detail that
Pi has and they do not.

Doing it now would make all three harnesses identical. Doing it later keeps this change to one
harness, which is the one whose export path is actually broken.

**Recommendation, and the default if no answer comes.** Later, as its own project. This design's
job is to make it possible, and after step 4 adding a harness is a writer plus a mapping, with no
runner, API, or wire change at all. That is the reuse claim, and it should be proved by a second
harness eventually, not by this pull request.
