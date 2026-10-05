# Plan: runner replicas

Terms in this file are defined in the [README glossary](README.md#glossary). The problem, what a
user sees today, and the four failure scenarios are in [context.md](context.md).

The plan has two stages:

- **Stage 1, the minimal design (private sandboxes).** Five common changes, plus one rule: a pod
  reconnects only to a sandbox it created, and deletes another pod's sandbox only through Kill.
  Two pods become safe. A follow-up on the other pod still costs a fresh sandbox.
- **Stage 2, design B (any pod adopts any sandbox).** No pod stops a shared sandbox, and the
  sandbox carries the facts that a pod needs to adopt it. A follow-up on the other pod costs
  seconds, and a restart no longer costs a fresh sandbox. The decision on design B comes at the
  end of stage 1, with measured data.

The five common changes are needed by both designs and by every alternative:

1. Bind the turn to its pod.
2. Stop goes to the turn's pod.
3. Verify the warm cache before use.
4. Kill by label inventory.
5. Drain, then cancel, then tear down.

## How the runner holds a session today

A runner pod keeps two kinds of memory about a session. The durable session log lives in the api
and survives any pod. The per-pod cache lives in the pod's memory and dies with it. A third
piece, the Secret allocation, decides who may use a sandbox. This section describes all three,
then follows one session through a fourth message on two pods.

### The durable session log

Everything that must outlive a pod is in the api's stores. The runner reads and writes it over
HTTP and has no database client of its own (research.md section 7).

| Record | Store | What it holds |
| --- | --- | --- |
| `session_turns` | Postgres | One row per turn: `turn_index`, `turn_id`, `sandbox_id`, `agent_session_id`, start and end time. A unique index covers `(project_id, session_id, turn_index)`. |
| `session_interactions` | Postgres | One row per approval question, with its status (`pending`, `responded`, `resolved`, `cancelled`) and the answer. |
| `session_commands` | Postgres | One row per control command (`cancel`, `continue_interaction`, `continue_input`), with its target turn, state, and `claimed_by`. |
| `session_executions` | Postgres | One row per execution, with exactly one terminal outcome. |
| Record log | Postgres (tracing database) | Every event of the session, in order. |
| `alive`, `running`, `started` | Redis | The turn that holds the session now, and when it started. |
| Harness transcripts | Object store, mounted into the sandbox | The Claude Code and Codex session files. |
| Pi transcript | Object store, prefix `pi-sessions` | The in-process Pi session file, saved after every turn. |

Two rules hold across these records:

- The alive and running keys admit at most one turn per session. Every other "who runs this"
  record is a copy of them (research.md section 11).
- The latest session_turns row is the pointer to the session's sandbox and harness session. A
  pod trusts its `agent_session_id` for session/load only when the row has an end time.

### The per-pod cache

A pod also holds live objects that no store can hold (research.md section 2):

- an HTTP client to the sandbox-agent daemon;
- an open ACP session;
- a pending `session/prompt` call;
- a pending permission request;
- on the in-process path, a live Pi session object.

The SessionPool holds them between turns.

On the Daytona path, a parked entry stays in the pool for 120 seconds. The sandbox runs, and the
ACP session stays open in this pod. The next turn on this pod is a warm hit with no setup. When
the timer fires, the pod removes the entry and stops the sandbox (park-to-stopped).

A pod with no entry takes the cold path:

1. Read the latest session_turns row (`POST /sessions/turns/query`, limit 1, newest first).
2. Reconnect to that row's `sandbox_id`. Start the sandbox if it is stopped.
3. If the reconnect fails, create a new sandbox.
4. If the row has an end time and an `agent_session_id`, call session/load with that id.
   Otherwise open a new harness session and rebuild the earlier turns from the record log.

A pod never joins another pod's ACP session. Each pod opens its own ACP connection to the
daemon, which serves it under a new server id (research.md section 12.1).

On the in-process path, a warm hit reuses the live Pi object. The cold path restores the Pi
transcript from the object store and replays it. Tools run in a command sandbox that the pod
creates on the first tool call. Another pod never reuses that command sandbox (research.md
section 4).

### Who owns a sandbox: the Secrets wrapper

By default, every Daytona-path sandbox goes through the Secrets wrapper, even a sandbox with no
Secret (research.md section 13.1). At create, the wrapper allocates the Daytona Secrets first,
with random names, and then creates the sandbox with those Secrets attached. It keeps the
Secret allocation in an in-memory registry, keyed by sandbox id. Nothing of the allocation is
written to Daytona or to the api.

At reconnect, the wrapper looks up the sandbox id in its registry:

- **An entry exists.** The wrapper checks the create fingerprint and the Secret set, and
  reconnects.
- **No entry exists.** The wrapper cannot prove which Secrets back the sandbox. It deletes the
  sandbox and reports a failure (`daytona-secret-provider.ts:429-439`). The reconnect steps
  then create a fresh sandbox.

So a Daytona sandbox is private to the process that created it. A restarted process, or a second
pod, deletes it on first contact. The conversation still continues, because session/load reads
the harness transcript from the mounted object store.

### The owner key and the direct Stop

Two more mechanisms tie a session to a pod.

**The owner key.** The Redis key `owner:<project>:session:<id>` holds `replica_id` and `turn_id`
with a 120-second lifetime (research.md section 5.3). Every heartbeat of a running turn claims
it, and the claim never takes the key from another live replica. A departed-owner path lets a
running turn take the key from a replica that has no running turn. More code exists only for the
key:

- `ownedSessions` and the `release_owner` beat at shutdown;
- the force-clear in Kill;
- the local provider's `LocalSandboxNotOwnerError`;
- the chart's `replicas == 1` pin of the replica id;
- a compare step in the orphan sweep.

Nothing routes a request by the key (research.md section 11).

**The direct Stop.** When a user presses Stop, the api writes a `cancel` row and posts `/cancel`
to the Service URL (research.md section 6):

- A pod that holds the session answers 202 and runs `applyCommand`. It aborts the live turn, or
  stops the parked approval: it rejects the gates, sends ACP `session/cancel`, and waits for the
  prompt to settle.
- A pod that does not hold the session answers 404. The api records `not_held`.
- While the turn still beats, the api delivers the command again, up to three times. After that
  it settles the command `lost`.

### Worked example: the fourth message on pod A and on pod B

Session `s1` uses Claude Code on the Daytona path. Pod A ran its first three turns. The values
are examples.

| `turn_index` | `turn_id` | `sandbox_id` | `agent_session_id` | End time |
| --- | --- | --- | --- | --- |
| 1 | `t1` | `daytona/sb-7f3` | `cc-9a1` | set |
| 2 | `t2` | `daytona/sb-7f3` | `cc-9a1` | set |
| 3 | `t3` | `daytona/sb-7f3` | `cc-9a1` | set |

After turn 3, pod A's pool holds the entry `proj:s1` in the `idle` state, with its 120-second
timer running. Sandbox `sb-7f3` runs. Pod A's registry holds the Secret allocation of `sb-7f3`.

**Message 4 reaches pod A (warm hit).**

1. The api starts turn `t4` and takes `alive` and `running` for it.
2. The services layer posts the turn to the Service URL, which picks pod A.
3. Pod A's first heartbeat admits `t4`.
4. Pod A finds `proj:s1` in its pool, and the config fingerprint matches.
5. Pod A appends row 4 (`sb-7f3`, `cc-9a1`), prompts the open ACP session, completes row 4, and
   parks the entry again.

Setup cost: none.

**Message 4 reaches pod B (what happens today).**

1. Steps 1 to 3 are the same, on pod B.
2. Pod B has no entry for `proj:s1`, so it takes the cold path. It reads row 3 and finds
   `daytona/sb-7f3`.
3. Pod B's Secrets wrapper has no registry entry for `sb-7f3`. It deletes `sb-7f3` and reports a
   failure.
4. Pod B creates a fresh sandbox, `sb-a21`, with new Secrets, and mounts the session folder.
5. Row 3 has an end time, so pod B calls session/load for `cc-9a1`. Claude Code reads its
   transcript from the mount, and pod B checks that the history arrived.
6. Pod B appends row 4 with `sb-a21`, prompts, completes row 4, and parks its own entry.

Setup cost: one sandbox create, one mount, and one session/load. Nobody has measured this on
the GKE stage; it is tens of seconds by estimate.

After the miss, pod A still holds `proj:s1`, with a client to a sandbox that no longer exists.
If message 5 reaches pod A inside its 120-second window, pod A takes a warm hit, and the turn
fails with a sandbox-gone error. On the in-process path the same sequence gives a silent reply
from a history without turn 4 (context.md, scenario 1).

The same steps 2 to 5 run at one replica after every restart. A deploy therefore already costs
each Daytona-path session one fresh sandbox on its next turn.

## The model

The runner is a stateless worker over the durable session log. Each pod adds a cache of live
connections, the SessionPool. Each sandbox is, today, owned by one pod.

Two pods are safe when four things hold:

1. A turn is bound to exactly one pod, and the api can reach that pod directly.
2. A pod never answers from a stale harness session.
3. A pod never destroys or stops a sandbox that another pod uses.
4. Stop and Kill work from the durable log and from the turn's pod, never from a shared address
   that picks a pod at random.

The five common changes establish the first, second, and fourth conditions. The third condition
has two answers. The minimal design keeps every sandbox private to its pod, so no pod ever uses
another pod's sandbox. Kill is the one exception, and it acts only after the session's turns have
ended. Design B lets every pod use every sandbox, and allows a stop or a delete only inside a
pod's own admitted turn, or through Kill.

## Changes common to both designs

### Bind the turn to its pod

#### Today

The owner key is a session-level lease: 120 seconds, never taken from a live replica, handed to
a replica with no running turn. A chain of code exists only for it (see "The owner key and the
direct Stop" above). It does not route anything.

It also fails at its one job. Two pods that beat the same `turn_id` are both admitted. The
departed-owner path treats a matching turn id as the caller's own lock. So the key passes between
the two pods on every beat, and neither turn is interrupted (research.md section 13.6).

Two more facts shape the change:

- **The first beat does not run the acquire script.** `_start_turn` takes `alive` for the turn
  before any runner beats (`streams/service.py:1203`). The runner's first beat therefore finds
  its own turn in `alive` and goes through `refresh_alive` (`streams/service.py:731`). The
  acquire script runs only when that refresh fails.
- **A normal beat carries the invoke caller's credential.** The heartbeat route checks the
  project permission. It checks the runner token only on the `release_owner` beat
  (`router.py:686-704`; `alive.ts:163`).

#### The change

1. **The heartbeat handler binds the turn on every beat that names it.** On a beat with a
   `turn_id`, the handler sets the key `bound:<project_id>:session:<session_id>:turn:<turn_id>`
   with `NX` to `<replica_id>\x1f<replica_address>`. It then reads the key back.
2. **A different replica is refused, and changes nothing.** When the stored replica id differs
   from the caller's, the handler answers `is_current_turn: false`. It changes no lock and no
   row. This holds for a running beat and for the final `is_running: false` beat. A refused pod
   still sends that final beat (`server.ts:942`), and today that beat releases `running` for the
   turn id it names (`streams/service.py:820-837`). With the binding, it cannot clear the
   admitted pod's `running`.
3. **The runner already stops on the refusal.** It reads `false` on the first beat as a refused
   admission and stops before it touches the sandbox (`alive.ts:385`).
4. **The binding lives as long as the turn.** The key has the TTL of `alive` (3600 seconds). Only
   a beat from the bound replica refreshes it. So it still names the pod of a parked turn, which
   holds `alive` without `running`.
5. **The address is authenticated as runner infrastructure.** The runner sends
   `X-Agenta-Runner-Token` on every beat, next to the project authorization it sends today. The
   api stores `replica_address` only when that token validates. Without a valid token, it binds
   the turn with an empty address and logs a warning.
6. **The runner reports its address.** The heartbeat request gains `replica_address`. On
   Kubernetes it is `http://<pod IP>:<runner port>`. The chart passes the pod IP through the
   downward API (`status.podIP`) and the configured runner port (`_helpers.tpl:160-163`). On
   compose and Railway the field is empty, and the api reads an empty address as "use the
   Service URL".
7. **The replica id becomes the pod name.** The chart sets `AGENTA_RUNNER_REPLICA_ID` from
   `metadata.name` at every replica count. The id stays a label and the claim identity in
   `session_commands.claimed_by`.
8. **The owner key goes, with the local-provider affinity probe.** Delete the key and every
   piece of code that exists for it. On the runner that includes the whole probe:
   - `LocalSandboxNotOwnerError`;
   - `claimSessionOwnership` (`alive.ts:235`) and its caller in `runtime-policy.ts:329`;
   - the guard in `environment-setup.ts:93-115`;
   - the reader of the owner in the heartbeat answer.

   The chart enforces one runner for the local provider instead (see "Drain, then cancel, then
   tear down").
9. **The alive handover and the `superseded` tombstone stay.** The orphan sweep keeps its
   turn-scoped release and the tombstone. It drops only the owner compare, which protected the
   owner key's own deletion and nothing else (`contract.py:228`).

The binding is a new key, not a new value inside `started:<turn>`. The `started` key holds epoch
milliseconds as a plain integer string. Two readers parse it as a number: `record_turn_start`
(`locks.py:315-345`) and the late-Stop guard in `DISPLACE_TURNS_LUA` (`contract.py:277-283`). The
binding also has a different role: `started` is a time that a guard compares, the binding is a
route.

#### Why this and not the alternatives

The alive and running keys decide which turn runs. The owner key tried to say which pod serves a
session, and a session is the wrong unit: a session moves between pods by design, a turn never
should. One write-once record per turn gives the api an exact address for Stop. It needs no
renewal of its own, no expiry of its own, and no takeover rule.

The handler writes the binding on every beat, not in the acquire script, because the first beat
of a normal turn never reaches the acquire script. Writing on every beat with `NX` costs one
`SET` that does nothing after the first time.

The alternatives:

- **Keep the owner key and add the address to it.** The key would still be a session-level
  lease, with the renewal, expiry, and takeover steps that cause #5611 and #6765. It would also
  still let two pods run one turn.
- **Store the address in the session_turns row.** The runner appends that row after it acquires
  the environment, which is seconds after admission. A Stop in that window would find no
  address. A project caller can also write that row, so it cannot carry a trusted address.
- **Share one replica id across pods.** Every pod then claims every session (#5404).

#### Deleted

- Redis: the `owner:` key, its claim script, `claim_owner_value`, and the claim helpers in
  `contract.py` and `locks.py`.
- Api: `_reclaim_affinity_from_a_departed_replica` and the owner branches of the heartbeat in
  `streams/service.py`; the owner force-clear in Kill; the request field `release_owner`; the
  owner compare in the orphan sweep.
- Api, one release later: the response field `replica_id`. A runner of the previous version
  reads it, so it stays for one release.
- Runner: `ownedSessions` and the shutdown release in `alive.ts`; the local-provider affinity
  probe listed in step 8.
- Chart: the `replicas == 1` condition around `AGENTA_RUNNER_REPLICA_ID`.
- Tests: the owner-key tests listed in research.md section 9.

The `/cancel` response field `replicaId` stays. Command settlement writes it to
`session_commands.claimed_by`.

#### Added

The `bound:` key in the heartbeat handler, the `replica_address` field, the runner token on
every beat, two downward-API entries in the runner Deployment (`metadata.name`,
`status.podIP`), and one runner setting for the address (`AGENTA_RUNNER_REPLICA_ADDRESS`).

#### Costs and side effects

- **The api trusts an address that a pod reports, and the runner token is the reason.** The api
  sends the shared runner token to the bound address on every Stop (`runner_client.py:123`). A
  project caller with only a project credential could otherwise record a URL of its choice and
  receive that token. The api therefore stores an address only from a beat that carries a valid
  runner token. The address is internal to the cluster.
- **Every beat now carries the runner token.** The token already travels on the outcome report
  and the shutdown beat. One more header on the beat adds no new holder of the token.
- **A pod IP can be reused.** After a crash, Kubernetes can give the same IP to a later pod. A
  Stop to that pod gets 404 `not_held`, which the existing path handles.
- **The local provider loses its runtime refusal on a second runner.** The chart makes that state
  impossible to deploy instead. The release gate matches the text "is not the owner of session",
  and a Codex QA script matches "single runner" (#6446). The same pull request updates both.
- **One more key per turn in the volatile Redis,** and one `SET` and one `GET` per beat. The key
  is small and expires with `alive`.

#### Verification

- Api unit test: a beat from a second replica for the same turn is refused, on the first beat and
  on a later one.
- Api unit test: a refused replica's final `is_running: false` beat leaves the admitted pod's
  `running` in place.
- Api unit test: a beat without a valid runner token binds an empty address.
- Api unit test: the heartbeat works with no owner key, and a parked turn keeps its binding.
- Runner unit test: a refused first beat stops the turn before the sandbox is touched.
- Release gate: the `cold2` journey replaces a runner with SIGKILL and must pass without waiting
  120 seconds for an owner key.

### Stop goes to the turn's pod

#### Today

The api posts `/cancel` to the Service URL, which picks a pod at random. The delivery goes
through one boundary: `_deliver` (`commands/service.py:1216`), which calls the direct adapter
(`control_delivery_direct.py:96`). The first delivery and every redelivery from the sweep use it.

The adapter maps the answer to a receipt:

- **202** means `accepted`.
- **404** means `not_held`. The api settles the command at once (`_settle_not_held`).
- **A transport failure** means `unreachable`. The command follows the abandoned-command path:
  the sweep delivers it again while the turn beats, up to three times, and then settles it
  `lost` (#6634; the fix, #6780, is open).

What the Stop does once it reaches the right pod is correct, and it stays:

- the immediate abort through `applyCommand`;
- the outcome report;
- the parked Stop, which rejects the gates and waits for the cancel to settle.

One gap sits in the parked case. `decideOutcome` (`control-channel.ts:214-231`) accepts a parked
session before it checks the command's target turn. A delayed Stop for an old turn can therefore
cancel a newer parked approval on the same session.

#### The change

1. **Resolve the address at the delivery boundary.** `_deliver` reads the target turn's binding
   and passes its `replica_address` to the direct adapter. The first delivery and every
   redelivery use the same rule.
2. **Post to the bound pod.** `cancel_runner_execution` (`runner_client.py:98`) gains an
   optional `base_url`. With an address, it posts there; with none, it posts to the Service URL.
3. **Keep the receipts distinct.** A 404 stays `not_held` and settles at once. A transport
   failure stays `unreachable` and follows the abandoned-command path. Once #6780 merges, an
   undeliverable Stop on a beating turn is parked instead of settled `lost`.
4. **Check the target turn for a parked session.** The parked branch of `decideOutcome` compares
   `command.target.turnId` with the parked turn's id. On a mismatch it answers `obsolete`, as the
   live branch does. `ParkedSessionControl` gains the parked turn's id for this.

The edge cases:

- **A Stop on a parked approval.** The binding still names the pod that holds the parked prompt,
  so `parked.stop()` runs there as today.
- **The pod of a parked approval is dead.** It held the only live copy of the prompt, so nothing
  is left to cancel. The delivery fails as `unreachable`. The outcome comes from the durable
  records: the interaction rows and the execution row.
- **The address is empty** (compose, Railway). The api posts to the Service URL, which is the one
  pod.
- **No binding exists.** Either no pod has beaten for the turn yet, or a runner of the previous
  version admitted it during the deploy. The api posts to the Service URL, as today.

The Service URL fallback is for compose, Railway, and the deploy transition only. At two replicas
an unbound turn cannot be routed reliably. So the chart must not set `replicas: 2` until every
runner pod runs the version that binds turns.

The address is reachable as the chart stands. The runner listens on `0.0.0.0`
(`hosting/kubernetes/helm/templates/_helpers.tpl:160-163`). The chart's only NetworkPolicy
covers the bundled data stores, is off by default, and does not select the runner pod.

#### Why this and not the alternatives

The only new fact a Stop needs is "which pod". The binding records it at admission. The change
adds no fan-out, no DNS discovery, no hash, and no proxy, and it does not change what Stop does.
Putting the lookup in `_deliver` keeps one rule for every attempt, so a redelivery cannot drift
back to the Service URL.

The alternatives:

- **Send Stop to every pod.** The api resolves every pod address through a headless Service and
  posts to each. Stop keeps its meaning. But the api gains pod discovery and partial-failure
  handling, and every Stop costs one request per pod.
- **Deliver Stop through the heartbeat.** Rejected; see "Stop delivered through the heartbeat"
  under the alternatives.
- **Hash the session id to a pod.** Two code bases need the same resolver, and it picks the wrong
  pod whenever the set of pods changes.

#### Deleted

Nothing.

#### Added

One Redis read in `_deliver`, the `base_url` parameter on `cancel_runner_execution`, and the
target-turn check in the parked branch of `decideOutcome`.

#### Costs and side effects

- **The api must reach pod IPs.** Inside one cluster it can. A NetworkPolicy that blocks api to
  runner traffic would break Stop; the chart documentation must say so.
- **A delayed Stop no longer cancels a newer parked approval.** It settles `obsolete`. That is the
  intended meaning, but it changes an outcome that a client may have seen before.
- **The chart rollout waits for the runner rollout.** Two replicas come only after every runner
  binds turns.
- **Compose and Railway see no change,** because the address is empty there.

#### Verification

- Api unit test: the first delivery and a redelivery both post to the recorded address.
- Api unit test: a 404 settles `not_held` at once; a transport failure follows the
  abandoned-command path.
- Api unit test: a Stop on a parked approval goes to the pod that parked it.
- Runner unit test: a delayed Stop whose target is an older turn answers `obsolete` against a
  newer parked approval.
- Release gate: a Stop of a turn that runs on pod B, sent while pod A also runs.

### Verify the warm cache before use

#### Today

The warm-hit decision compares fingerprints of the incoming request with the pool entry
(research.md section 3.6). Nothing compares the entry with the durable log. The playground sends
only the last user message, so the history fingerprint check is skipped for it (research.md
section 12.7).

The turn-start write of the session_turns row ignores every failure: a 409 for a duplicate
`turn_index`, any other error status, and a network failure
(`session-continuity-durable.ts:262-269`). An approval resume legitimately appends the same
index as its paused turn. Its 409 is expected, and the row keeps the paused turn's `turn_id`
(research.md section 13.8).

When a continuation throws, the coordinator evicts the entry as `failed-turn` and retries the turn
once on the cold path (`session-coordinator.ts:1134-1140`).

The marker that stops a pod from rebuilding history from a record log with a hole is a set in
one pod's memory (research.md section 13.2). Another pod does not see it.

#### The change

**Before a warm hit, read the latest row.** This covers the `hit-continue` branch and the
approval-resume branch in `services/runner/src/lifecycle/session-coordinator.ts`.

1. Read the latest session_turns row with the existing query, using the turn's authorization.
2. Compare the row's `turn_index` with the entry's `continuityTurnIndex`. They are equal exactly
   when no other pod appended a turn since this pod parked.
3. On a mismatch, evict the entry with the existing reason `continuity-invalid` and take the cold
   path.
4. On a match, take the warm hit.
5. When the read fails, refuse the warm hit and fail the turn with an error that names the cause:
   the runner could not confirm that its warm session is current. The entry stays in the pool.

The compare uses `turn_index`, not `turn_id`. An approval resume reuses its paused turn's index,
and its benign 409 leaves the row with the paused turn's `turn_id`. A `turn_id` compare would
evict a valid warm entry after every resume.

The check has no race. It runs inside the pod's own admitted turn, which holds `alive` and
`running`, so no other pod can append a row until this turn ends.

**Make the 409 benign only for a resume.** The runner knows before the append whether the turn
is a resume (`opts.resume`, `settleApprovalsThenPrompt`, `carriesApprovalReplyOnly`; research.md
section 13.8).

- For a resume, the 409 stays silent, as today.
- For a fresh prompt, the runner logs an error and ends the turn with an error that names the
  cause: another runner already wrote this turn index. It evicts the entry as
  `continuity-invalid`. It does not take the coordinator's `failed-turn` eviction and cold retry.

The append happens before the prompt (research.md section 12.3), so a refused fresh append never
sends a stale prompt.

**Make "records incomplete" durable.** When a record ingest fails all its retries, the runner
also posts the fact to the api. The api stores it with the record log, and the records query
returns it. The reconstruct step reads it from that query, on any pod. The interface is in "The
records-incomplete flag" below. A gap in the record sequence cannot carry this fact, because a
dropped record never received a sequence number (research.md section 13.2).

#### Why this and not the alternatives

The pool is a cache of the durable log, and nothing checks that the cache is current. The
alternatives:

- **A shared record of which pod holds the warm entry.** That is a second copy of "who owns the
  session", with renewal, expiry, and takeover: the owner key again.
- **Trust the history fingerprint.** The playground sends one message, so the fingerprint has
  nothing to compare.
- **Read the turn log.** It already records which turn came last, and it is the record every pod
  writes.

The design reads the turn log. A failed read fails closed. The append that follows also swallows
network failures, so a failed read plus a failed append would otherwise let a stale prompt
through. The first-beat admission already fails closed when the api does not answer, so this is
the same rule.

On a mismatch the design uses the existing eviction reason, so the teardown follows today's rules
for that reason. What that teardown does to the sandbox differs by design: the minimal design
stops the pod's own sandbox, and design B touches no sandbox at all.

A fresh-prompt 409 skips the cold retry because the retry would hide the cause. The user sees one
clear error, and the next message takes the cold path from the latest row.

#### Deleted

The silent `.catch(() => {})` on the turn-start write for the fresh-prompt case
(`run-turn.ts:764`, `session-continuity-durable.ts:262`).

#### Added

The read before a warm hit, the resume test before the append, the incomplete-flag write and
read, and the api route and column for the flag.

#### Costs and side effects

- **One more api round trip per warm hit,** a few milliseconds.
- **An api failure at that moment now fails the turn.** Today the warm hit would go ahead. The
  window is narrow, because the turn's first beat has just reached the api.
- **A fresh-prompt 409 now shows the user an error.** Today the user gets a reply from the wrong
  history instead.
- **The incomplete flag adds one write on a rare path.** If that write also fails, only the pod
  that dropped the record knows, as today.

#### Verification

- Runner unit test: the latest row's `turn_index` equals the entry's, so the turn is a warm hit.
- Runner unit test: an approval resume after a benign 409 is still a warm hit.
- Runner unit test: another pod appended a row, so the pod evicts and takes the cold path.
- Runner unit test: the read fails, so the turn fails with the named error and the entry stays.
- Runner unit test: a resume 409 is silent; a fresh 409 ends the turn, evicts as
  `continuity-invalid`, deletes nothing, and makes no cold retry.
- Runner unit test: a flag written on one pod stops a reconstruct on another pod.
- Implementer check: confirm that `EntityCreationConflict` maps to HTTP 409. research.md section
  12.3 did not read that line.

### Kill by label inventory

#### Today

`POST /kill` drains the receiving pod's pool entry and its in-flight sandboxes, and answers 200
whether or not it found anything (research.md section 6.3). The api never reads
`session_turns.sandbox_id` and never calls Daytona (research.md section 6.4).

The turn rows are not a usable list of a session's sandboxes:

- **A project caller can write `sandbox_id`.** The turn append route accepts it from any caller
  with the project permission (`router.py:1966-1980`). A row is not a safe authority to delete a
  Daytona sandbox.
- **The column misses sandboxes.** The in-process path creates its command sandbox on the first
  tool call, after the row exists, and never writes the id back (research.md section 13.7). It
  can also replace that sandbox mid-session when its credentials change
  (`command-sandbox.ts:361-370`), and a write-once column cannot record the replacement.

Labels already exist on one path. The in-process command sandbox carries `agenta.project` and
`agenta.conversation` (`conversation-registry.ts:74-77`). The Daytona-path create request sets
no labels (`provider.ts:95-124`).

#### The change

1. **Label every Daytona-path sandbox at create.** The create request gains two labels,
   `agenta.project` and `agenta.conversation`, after `envVars` (`provider.ts:113`). The create
   fingerprint excludes them (see "The Daytona labels" below).
2. **The api kill does not change.** It posts `/kill` with today's body to the Service URL.
3. **The receiving pod drains, then lists, then deletes.** It drains its own pool entry and
   in-flight sandboxes as today. It then lists sandboxes with both labels set to the request's
   `projectId` and `sessionId`. It deletes each one. For a sandbox whose Secret allocation it
   holds, it also deletes the Secrets. Not-found counts as success.

This is the label inventory: the labels answer both "which sandboxes belong to this session" and
"may this request delete them".

Kill is the one exception to the rule "a pod never deletes a sandbox it did not create". The api
has already ended the session's turns, so no other pod can start a turn on these sandboxes. A pod
that still holds one in its pool learns of the delete when its timer fires or its next turn hits
the sandbox-gone check.

Sandboxes created before the labels have no inventory. Only the pod that owns them deletes them,
from its pool, as today. That set shrinks to nothing within one autodelete cycle of the deploy.

#### Why this and not the alternatives

- **Read the ids from the turn rows.** A project caller can write the column, and the column
  misses replaced and late-created command sandboxes.
- **Let the api call Daytona.** The api has no Daytona client and no Daytona credentials.
- **Send `/kill` to every pod.** This needs pod discovery in the api, and it still misses a
  sandbox that no pod holds, such as a stopped one.

The labels are written by the runner at create, from the request it serves, so they carry the same
trust as the sandbox itself. One list query covers both providers.

#### Deleted

Nothing.

#### Added

Two labels on the Daytona-path create, and the list-and-delete step in the runner's `/kill`.

#### Costs and side effects

- **Kill becomes a Daytona list call plus one delete per sandbox.** A failed delete does not stop
  the others. The failure is logged, and Daytona's autostop and autodelete remove the sandbox
  later.
- **Secrets of a sandbox that another pod created stay orphaned.** Only the creating pod knows
  them. They remain until design B's slot manifest, or #6438.
- **Pre-label sandboxes are deleted only by their owner.** A Kill that reaches another pod leaves
  them to Daytona's timers.
- **A sandbox still being created may not be listed yet.** Its pod's own lifecycle or Daytona
  removes it.
- **List latency is unknown.** The second spike measures it.

#### Verification

- Runner unit test: a pod with no entry deletes every sandbox the label list returns.
- Runner unit test: not-found counts as success; a failed delete does not stop the loop.
- Runner unit test: Secrets are deleted only for sandboxes whose allocation this pod holds.
- Runner unit test: the create fingerprint is the same with and without labels.
- Implementer check: the in-process `conversationId` equals the session id.
- Release gate: Kill sent to the pod that does not hold the session leaves no labelled sandbox.

### Drain, then cancel, then tear down

#### Today

At SIGTERM the runner (research.md sections 12.5 and 13.5):

1. Interrupts in-process turns within 5 seconds. Only in-process turns register in the
   `active-turns` set that this step reads.
2. Stops the sandboxes of idle entries, and deletes the sandboxes of busy and parked entries.
3. Deletes the sandboxes of turns in flight.
4. Sends the `release_owner` beats.

It sends ACP `session/cancel` but does not wait for the harness to settle. The existing rule for
a user Stop is: a settled cancel (`cancelled`) parks the sandbox, an unsettled one (`aborted`)
deletes it.

The chart uses `strategy: Recreate`, so no runner pod exists during a restart. It gives the pod
300 seconds of grace and a 10-second `preStop` delay.

#### The change

The runner, at SIGTERM:

1. **Drain.** Set a flag. The one handler behind `/run` and `/stream` (`server.ts:1601-1606`)
   answers 503 from now on. `/cancel` and `/kill` stay available, so a Stop or a Kill still
   reaches the turns this pod runs. Kubernetes removes the pod from the Service endpoints on its
   own schedule, so the pod must refuse new work itself.
2. **Wait.** Let every admitted execution finish, Daytona and in-process alike, for at most the
   grace period minus a margin. The wait reads the execution registry, not the in-process
   `active-turns` set. The chart passes the limit, for example 230 seconds out of 300.
3. **Cancel.** Cancel what still runs with `cancelHarnessTurn`, and wait for the settled result.
   Give each parked prompt the same explicit cancel and wait for it to settle.
4. **Tear down.** In the minimal design, delete every sandbox the pod holds. In design B, delete
   a sandbox whose cancel did not settle, and leave every other sandbox running. Daytona stops it
   after its idle interval, and any pod can adopt it before or after that.
5. Exit.

The 5-second budgets of today's shutdown grow to fit step 2.

The minimal design deletes everything at step 4, idle and parked sandboxes included. No other
process can reconnect to them, so a stopped one would only wait 30 minutes for autodelete. The
settled wait still matters there: it lets the harness finish writing its transcript to the
mount, so the next pod's session/load finds a complete history.

Design B does not stop sandboxes at shutdown. Another pod may already use the sandbox, and a
stop would end that pod's turn (see "Daytona does all the stopping").

The chart:

- `strategy: RollingUpdate` with `maxSurge: 1` and `maxUnavailable: 0` when only remote providers
  are enabled. Kubernetes starts a new pod and waits until it is ready before it stops an old one.
- `strategy: Recreate` stays when the local provider is enabled, and the template fails to render
  when `agentRunner.replicas` is greater than 1 with the local provider.
- `AGENTA_RUNNER_REPLICA_ID` from `metadata.name`, and the pod IP from `status.podIP`, at every
  replica count.
- `agentRunner.replicas: 2` in the GKE values, only after every runner binds turns (see "Stop goes
  to the turn's pod"). The chart default stays 1.
- The PodDisruptionBudget stays.

#### Why this and not the alternatives

Today a deploy cancels every running turn within seconds. With one pod there was nowhere else
for new turns to go, so waiting gained nothing. With two pods, the other pod takes new turns
while the leaving pod finishes its own. The 300-second grace period exists for this purpose
(#7320).

The control endpoints stay open during the drain because the turns are still running there. A
user who presses Stop during a deploy must reach the pod that runs the turn.

The alternatives:

- **Keep today's shutdown.** Every deploy and node drain kills running turns.
- **Stop without a settled cancel.** The harness can be cut off mid-write, and the next
  session/load can find a partial transcript. This is the reason today's rule deletes an
  unsettled sandbox (research.md section 12.5).

#### Deleted

The `release_owner` step, the `replicas == 1` condition, and the chart comment that explains
`Recreate` for the runner.

#### Added

The drain flag, the wait over the execution registry with its setting, the settled cancel of
running turns and parked prompts at shutdown, the disposition by design, and about ten lines of
chart.

#### Costs and side effects

- **A rolling deploy is slower.** Each pod can take up to the grace period to leave, so two pods
  can take about ten minutes.
- **A turn that outlives the wait is still cancelled.** The orphan sweep does not see it as lost,
  because the cancel ends it normally.
- **A late request gets a 503.** A request that reaches the pod after SIGTERM and before
  Kubernetes removes it from the endpoints fails. The 10-second `preStop` delay makes the window
  small. The SDK transport does not retry a 503 today (`ts_runner.py:198`).
- **A parked approval still loses its live prompt.** The prompt is cancelled at shutdown. The
  user's answer runs on the cold path through the stored decision, as today.
- **In design B, a leaving pod's sandboxes run a little longer.** They run until Daytona's idle
  interval stops them, 2 or 3 minutes.
- **Hosted device login breaks at two pods.** A login attempt lives in one pod's memory, and a
  poll can reach the other pod. The fourth decision covers it.
- **Compose keeps its own grace.** Docker's default stop timeout is 10 seconds, so on compose the
  wait is as short as the compose file allows.

#### Verification

- Runner unit test: after SIGTERM, `/run` and `/stream` answer 503, and `/cancel` and `/kill`
  still work.
- Runner unit test: the wait covers a Daytona turn, not only in-process turns.
- Runner unit test: a parked prompt gets a settled cancel before teardown.
- Runner unit test: in design B a settled cancel leaves the sandbox running, and an unsettled one
  deletes it; in the minimal design every sandbox is deleted.
- Chart test: `Recreate` renders with the local provider, and the render fails for the local
  provider with `replicas > 1`.
- Live check on the GKE stage: a rolling deploy during a turn; the turn finishes.

## The minimal design: private sandboxes

The minimal design is the five common changes plus one rule. **A pod reconnects only to a
sandbox it created. It never deletes a sandbox it did not create, except through Kill.**

### The rule

- **Reconnect only to your own sandbox.** Each process keeps a set of the sandbox ids it created.
  The reconnect steps reconnect only to an id in that set. For any other id they create a fresh
  sandbox. This holds whether or not the Secrets wrapper runs. With opaque Secrets turned off,
  the wrapper does not run, and the plain reconnect would otherwise adopt another pod's sandbox.
- **Never delete another pod's sandbox.** The wrapper's no-entry branch
  (`daytona-secret-provider.ts:429-439`) reports the failure without deleting the sandbox.
- **Kill is the exception.** "Kill by label inventory" deletes every labelled sandbox of the
  session, whichever pod created it.
- **The other sandbox is left to its owner.** Its owner's pool timer stops it, or Daytona's
  autostop (15 minutes after the last SDK call) and autodelete (30 minutes after the stop) remove
  it.

With this rule, a pod only ever uses, stops, or deletes its own sandboxes outside Kill. That is
why the warm cache check can evict with a normal teardown: the sandbox it stops is its own, and no
other pod uses it.

### What a user gets

Two pods are correct. A follow-up on the other pod costs a fresh sandbox create plus
session/load: tens of seconds by estimate, to be measured. At two pods with random routing, that
is half of all follow-ups. It is also the cost that every session already pays on the first turn
after any deploy today.

A session that moves back and forth pays the create each time. Message 2 on pod B creates a
sandbox. Message 3 on pod A finds that pod B wrote the latest turn, evicts its own entry, and
creates another.

### Deleted and added

Nothing is deleted beyond the owner key of the common changes. The rule adds a process-local set
of created ids, a check in the reconnect steps, and the removal of the delete in the wrapper's
no-entry branch.

### Costs and side effects

- **The miss cost.** A full create on half of all follow-ups at two pods.
- **Two sandboxes per moved session for a while.** The first pod's copy runs until its pool timer
  stops it (120 seconds), or until Daytona autostop when that pod is gone.
- **New Daytona Secrets on every move.** Each fresh create allocates its own Secrets.
- **A crashed pod's sandboxes live up to 45 minutes.** They run until autostop (15 minutes) and
  stay stopped until autodelete (30 minutes). Their Secrets stay orphaned.
- **Park-to-stopped still does not survive a restart.** A new process has an empty set of created
  ids, so it creates fresh. The restart cost of today stays, but the old sandbox is no longer
  deleted on contact; Daytona removes it.

The minimal design does not make pods interchangeable. It makes them safe.

### Verification

- Runner unit test: the reconnect steps create fresh for an id this process did not create, with
  opaque Secrets on and with them off.
- Runner unit test: the wrapper never deletes a sandbox without a registry entry.
- Two-process test: park on A, continue on B, and check that A's sandbox is untouched.

## Design B: any pod adopts any sandbox

### The goal

A follow-up on another pod reuses the session's sandbox instead of creating one. The pod that
leaves destroys nothing. A stopped sandbox survives a restart again.

Design B has two parts, deployed in this order:

1. **"Daytona does all the stopping" (B2).** No pod stops a shared sandbox. It ships to every pod
   first, while adoption is still off.
2. **"The sandbox describes itself" (B1).** A pod can prove a sandbox's Secrets and adopt it. It
   ships in a later release, after every process of the earlier version has exited.

Two spikes come before any code.

### The invariant

**No pod stops or deletes a sandbox outside three cases: its own admitted turn's failure path,
the stop before adoption in its own admitted turn, and Kill.**

Every other stop and delete goes. That includes the pool's park-to-stopped. It also includes
the Secrets wrapper's own paths that stop or delete: its `pause()` and cleanup timer
(`daytona-secret-provider.ts:496`), its cleanup retries, and its failure teardown.

### Daytona does all the stopping (B2)

#### Today

The pool timer stops a sandbox at the idle TTL (120 seconds) and deletes it for non-parkable
reasons. The Secrets wrapper adds its own stop and cleanup paths. Daytona's autostop (15 minutes)
removes what the runner leaves. With shared sandboxes, a stale pod's stop would hit a sandbox
that another pod now uses: scenario 1 of context.md, made worse.

#### The change

1. **Eviction releases local resources only.** It closes the client, forgets the entry, and
   removes local folders. It sends no stop and no delete.
2. **The wrapper follows the invariant.** Its `pause()`, its cleanup timer, its cleanup retries,
   and its failure teardown stop or delete a sandbox only in the three allowed cases.
3. **Daytona's autostop becomes the idle bound.** Set `autoStopInterval` to 2 or 3 minutes. It
   must stay above the pool's idle TTL, so that a warm hit never finds a stopped sandbox.
4. **The runner feeds Daytona activity during a turn.** Every 30 seconds, with the liveness probe,
   the runner calls `refreshActivity`, which is an SDK `get`. This also fixes the 15-minute
   autostop risk of a long turn (research.md section 13.9).
5. **Any pod starts a stopped sandbox.** The reconnect steps already do this.
6. **The park-to-stopped code goes.** The timer-driven `pauseSandbox` and the split between
   parkable reasons for the stop case are deleted. Deletes stay for the non-parkable reasons in the
   pod's own admitted turn: `failed-turn` and `aborted`.

Before adoption ships, this part changes only who stops a sandbox. The minimal rule still sends a
follow-up on another pod to a fresh create.

#### Why this and not the alternatives

With shared sandboxes, no pod can know that its stop is safe. Between its check and its stop,
another pod can start a turn on the same sandbox. The simplest rule is that no pod stops anything
outside its own turn. Daytona already has the idle timer; the runner only has to feed it during
turns.

The alternative is a check before every stop, as in "Verify the warm cache before use". It leaves
a window between the check and the stop, and a stop that lands in that window ends another pod's
turn.

This part ships before adoption so that, when adoption begins, no running process still has the
old stop paths.

#### Costs and side effects

- **The idle bound moves from 120 seconds to Daytona's interval,** 2 or 3 minutes. A delay on
  Daytona's side adds billed minutes.
- **The design leans on one SDK sentence.** The SDK says that SDK interactions reset autostop.
  Whether a read such as `get` counts is not stated; the runner's own comment says "believed". The
  second spike verifies it on a live sandbox.
- **A long turn now depends on the in-turn refresh.** Today it depends on nothing, and by the SDK
  documentation it can lose its sandbox after 15 minutes.
- **Reverting it while adoption is on is unsafe.** The old stop paths would stop sandboxes that
  other pods have adopted. Revert adoption first.

### The sandbox describes itself (B1)

#### Today

The registry entry holds the Secret allocation (research.md section 13.1). It has the map from
environment variable to Secret name, the placeholders, and the created Secret records with their
Daytona ids. It also has the plan, the create fingerprint, and a generation counter. The wrapper
allocates every Secret before it creates the sandbox. It gives each Secret its own random name,
`agenta_<36 hex>_<ordinal>` (`daytona-secrets.ts:255-260`). Nothing of this is on Daytona.

Two facts rule out rebuilding the allocation from the incoming request alone:

- **Ordinals follow the request's iteration order** (`daytona-secret-plan.ts:238`). A later
  request with the same credentials in another order would derive other names.
- **The reconnect check compares slot sets** (`provider.ts:152`, `daytona-secret-provider.ts:460`).
  If the pod rebuilt the slot set from the incoming request, the check would compare the request
  with itself and always pass.

#### The change

1. **An immutable slot manifest per sandbox.** At create, the wrapper writes a slot manifest with
   the sandbox: for each slot, its slot key, its Secret name, its allowed hosts, and its
   placeholder. It never changes after create. It is a label if Daytona's label limits allow;
   otherwise a small object that the api stores, keyed by sandbox id. The second spike decides.
2. **One allocation id per create.** The Secret names become `agenta_<allocation id>_<ordinal>`.
   The retained-lease path, which reuses a lease for a replacement sandbox, keeps the allocation
   id it inherits.
3. **Two more labels.** The create request adds `agenta.create_fingerprint` next to the two
   inventory labels of "Kill by label inventory". The create fingerprint excludes all labels.
4. **Adoption on reconnect.** A pod with no registry entry for a sandbox, inside its own admitted
   turn:
   1. reads the sandbox's labels and slot manifest;
   2. checks that `agenta.project` and `agenta.conversation` match the request;
   3. computes the create fingerprint from its own request and compares it with the label;
   4. compares the request's slot set with the manifest's slot set;
   5. lists the Daytona Secrets by name and keeps only exact matches, because the SDK's name
      filter matches parts of names;
   6. rebuilds the registry entry from the manifest and the Secret records;
   7. writes the current credential values into those Secrets before the turn runs, through the
      existing retained-lease path;
   8. reconnects.
5. **Stop before adopting, as the baseline.** If the daemon spike shows that a stop ends the old
   pod's adapters, adoption first stops a running sandbox, then starts it. A miss then costs a
   sandbox stop and start, which is still far cheaper than a create. Adoption of a running
   sandbox without a stop comes only if the spike shows that it is safe.
6. **Mismatch or missing manifest.** On a fingerprint or slot-set mismatch, the pod has proven the
   Secrets from the manifest. It deletes the sandbox and its Secrets inside its own admitted turn
   and creates fresh. A sandbox without a manifest, created before this change, follows the
   minimal rule: fresh create, no delete.
7. **Kill deletes the Secrets too.** Kill reads each listed sandbox's manifest and deletes its
   Secrets by name, whichever pod created it.

The registry becomes a cache of facts that any pod can read back. The delete-on-missing-entry
branch goes away.

#### Why this and not the alternatives

- **Derive the names from the request.** The order dependence and the circular slot-set check
  above rule it out.
- **A mutable allocation table in the api.** It must be written at create, updated on every
  change, deleted at destroy, and reconciled after every crash. That reconciliation is the whole
  problem of #6438.
- **An immutable manifest written with the sandbox.** It is written once, never updated, and
  describes one sandbox. On a label, the sandbox is its single source. In the api, it is a second
  copy, but one that never changes and needs no reconciliation beyond deletion with the sandbox.

The design chooses the manifest, on a label when it fits.

#### Costs and side effects

- **A manifest in the api, if labels are too small, is a second copy.** It must be deleted with
  its sandbox, and a crash between create and the manifest write leaves a sandbox that no other
  pod can adopt.
- **Adoption writes Secrets before the turn runs.** That adds Daytona calls to the first turn on a
  new pod.
- **Secret names become predictable from the allocation id.** They still protect only the
  mapping. The values stay in Daytona and never reach the plain environment.
- **Sandboxes created before this change are not adoptable.** The first deploy treats them as
  today: a fresh create on the next turn.
- **The Secrets wrapper is security-adjacent code,** and both its naming scheme and its cleanup
  paths change.

### Two spikes that gate design B (B3)

1. **The daemon with two ACP servers on one harness session.** Pod A parks a session. Pod B
   reconnects to the same sandbox and calls session/load on the same native session. Observe pod
   A's orphaned adapter: its memory, whether it writes to the transcript file, and what pod A's
   later `session/cancel` or disconnect does to pod B's session. Then stop and start the sandbox
   and check that no adapter of pod A survives. The daemon is upstream `rivetdev/sandbox-agent`
   0.5.0-rc.2 (research.md section 12.1). The outcome decides between stop-before-adopt and live
   adoption.
2. **Daytona semantics.** Answer five questions on a live sandbox:
   1. Does an SDK `get` reset autostop?
   2. Does preview traffic reset it?
   3. What size and count limits apply to labels, and does a slot manifest fit?
   4. How long do a list by label and a list of Secrets by name take?
   5. Does the Secret list return each Secret's placeholder and allowed hosts?

### What design B gives and costs

**Gives:**

- Pods are interchangeable.
- A follow-up on another pod costs a sandbox stop and start plus session/load with the baseline,
  or a reconnect plus session/load with live adoption. Both are far cheaper than a create.
- A leaving pod destroys nothing; it leaves its sandboxes for Daytona to stop or another pod to
  adopt.
- A stopped sandbox survives a restart again, so a deploy no longer costs each session a fresh
  sandbox.
- Kill deletes the Secrets of every sandbox, and orphaned Secrets (#6438) become findable by
  prefix.
- The park-to-stopped timer code, the wrapper's own stop paths, and the delete-on-missing-entry
  branch are removed.

**Costs:**

- Two spikes before any code, and two releases to roll it out in a safe order.
- The Secrets wrapper, a security-adjacent module, changes its naming scheme, its cleanup paths,
  and its reconnect.
- A slot manifest, possibly stored in the api, plus the credential write on adoption.
- A migration window in which old sandboxes are not adoptable.
- The idle bound depends on Daytona's timer.
- The daemon's behaviour is outside this repository, so a fix upstream may be needed.
- About 400 to 600 changed lines in the runner, and more if the manifest lives in the api. The
  deletions no longer balance the additions (an estimate). The risk sits in
  `daytona-secret-provider.ts`, `daytona-secret-plan.ts`, `sandbox-lifecycle.ts`, and
  `session-pool.ts`.

## Interface changes, reviewed by semantic role

Each change below lists what each field is, who owns it, when it changes, and its role.

### The turn binding

**Before.** One key per turn holds the start time:

```text
started:<project_id>:session:<session_id>:turn:<turn_id> = "1791234567890"
```

**After.** A sibling key holds the binding. `started` does not change.

```text
started:<project_id>:session:<session_id>:turn:<turn_id> = "1791234567890"
bound:<project_id>:session:<session_id>:turn:<turn_id>   = "agenta-runner-6f9c7d5b8-x2lqp\x1fhttp://10.8.2.17:8765"
```

| Field | What it is | Owner | Changes | Role |
| --- | --- | --- | --- | --- |
| `replica_id` | The pod name | Runner, from the chart | Per process | Identity, for logs and `claimed_by` |
| `replica_address` | The URL that reaches this pod, empty when unauthenticated or on compose | Runner, from the chart; accepted only with the runner token | Per process | Routing |

The reasons for this shape:

- **A separate key, not a new value in `started`.** `started` is a time that two readers parse as
  a number. The binding is a route. Different roles get different keys.
- **The same key layout as `started`,** so the key is found the same way and expires with the
  same rule. The name `bound` follows the past-participle style of `started` and `superseded`.
- **The separator `\x1f`** is the one the owner key uses today (`contract.py:56-63`).
- **Write-once, written by the heartbeat handler.** `NX` makes a second writer a refusal, not a
  takeover. The handler writes it because the first beat of a normal turn never reaches the
  acquire script.

### The heartbeat request and response

**Request, before:**

```http
POST /sessions/streams/heartbeat
Authorization: <project credential of the invoke caller>

{
  "session_id": "019d952f-0000-0000-0000-000000000001",
  "replica_id": "5b1e0c9a-0000-0000-0000-000000000000",
  "turn_id": "019d952f-0000-0000-0000-000000000004",
  "is_running": true,
  "release_owner": false
}
```

**Request, after:**

```http
POST /sessions/streams/heartbeat
Authorization: <project credential of the invoke caller>
X-Agenta-Runner-Token: <runner token>

{
  "session_id": "019d952f-0000-0000-0000-000000000001",
  "replica_id": "agenta-runner-6f9c7d5b8-x2lqp",
  "replica_address": "http://10.8.2.17:8765",
  "turn_id": "019d952f-0000-0000-0000-000000000004",
  "is_running": true
}
```

**Response, before:** `{"stream": {...}, "replica_id": "...", "is_current_turn": true}`.
**Response, after:** the same for one release, then `{"stream": {...}, "is_current_turn": true}`.

The reasons:

- **Two credentials, two roles.** The project credential authorizes the beat for this session,
  as today. The runner token proves that the caller is runner infrastructure, which is what makes
  its address safe to send the runner token to later. The token rides its existing header,
  `X-Agenta-Runner-Token`, so the `Authorization` header keeps one meaning.
- **`replica_address` sits next to `replica_id`, flat.** Both describe the calling pod and change
  only when the process changes. A nested `replica: {id, address}` object would read better, but
  it renames a field that every runner version sends, for no second consumer.
- **The address is a URL, not a pod IP.** The URL is the stable concept. The pod IP is the
  Kubernetes mechanism, and compose has none. The runner reads it from
  `AGENTA_RUNNER_REPLICA_ADDRESS`, which the chart builds from the pod IP and the configured
  runner port.
- **An empty address means "use the Service URL".** Compose and Railway need no new setting.
- **`release_owner` goes now; the response `replica_id` goes one release later.** Both existed
  for the owner key, and a runner of the previous version still reads the response field.
- **No new meaning for `is_current_turn: false`.** A refusal by the binding is the same "this
  turn is not yours" that the runner already reads. The owner-mismatch meaning goes away with the
  owner key, so the field loses one of its three meanings (#6765).

### The `/cancel` route

The body does not change. Two behaviours do:

- The api posts it to the bound pod's address, resolved in `_deliver`.
- The runner's parked branch checks `target.turnId` against the parked turn.

The response keeps `replicaId`, which command settlement writes to `claimed_by`.

### The `/kill` route

The body does not change: `{ "sessionId": "...", "projectId": "..." }`. The receiving pod lists
the session's sandboxes by label instead of trusting any id it is sent. The route is the same, so
no caller changes.

### The Daytona labels

**Before.** The Daytona-path create request sets no labels. The in-process command sandbox
already carries `agenta.conversation` (the session id), `agenta.project`, `agenta.credentials`,
`agenta.owner`, and `agenta.deployment` (`command-sandbox.ts:417-423`,
`conversation-registry.ts:74-77`).

**After stage 1, on the Daytona path:**

```json
{
  "labels": {
    "agenta.project": "019d952f-0000-0000-0000-0000000000a1",
    "agenta.conversation": "019d952f-0000-0000-0000-000000000001"
  }
}
```

**After design B, on the Daytona path:**

```json
{
  "labels": {
    "agenta.project": "019d952f-0000-0000-0000-0000000000a1",
    "agenta.conversation": "019d952f-0000-0000-0000-000000000001",
    "agenta.create_fingerprint": "3f1c9e0d0000000000000000000000000000000000000000000000000000a7b2",
    "agenta.secret_manifest": "<the slot manifest, if it fits>"
  }
}
```

| Label | What it is | Owner | Changes | Role |
| --- | --- | --- | --- | --- |
| `agenta.project` | The project id | Runner, from the request | Per sandbox | Inventory and ownership check, for Kill and adoption |
| `agenta.conversation` | The session id | Runner, from the request | Per sandbox | Inventory and ownership check, for Kill and adoption |
| `agenta.create_fingerprint` | The SHA-256 of the image and create request, labels excluded | Runner | Per sandbox | Integrity check before adoption |
| `agenta.secret_manifest` | The slot manifest | Secrets wrapper | Written once at create | Reference to the Secrets |

The reasons:

- **The same two inventory keys as the in-process path,** instead of one combined
  `agenta.session = <project>:<session>`. One list query then finds a session's sandboxes for
  both providers, and each value is filterable without parsing.
- **Labels stay out of the create fingerprint.** The fingerprint label would otherwise contain
  itself, and the inventory labels would change the hash for every session.
- **The fingerprint is a separate label,** because its role is a check, not an inventory key.
- **The manifest holds references, not secrets.** It names the Secrets and their placeholders;
  it reveals no value.
- **No `agenta.owner` on the Daytona path.** In design B any pod may adopt the sandbox, so a
  creating-pod label would mislead.

### The slot manifest

The manifest is one entry per Secret slot:

```json
{
  "allocation": "9c4e2a7b0000000000000000000000000000",
  "slots": [
    {
      "slot": "model:openai",
      "secret": "agenta_9c4e2a7b0000000000000000000000000000_0",
      "hosts": ["api.openai.com"],
      "placeholder": "AGENTA_SECRET_PLACEHOLDER_0"
    }
  ]
}
```

| Field | What it is | Owner | Changes | Role |
| --- | --- | --- | --- | --- |
| `allocation` | The id shared by this sandbox's Secret names | Secrets wrapper | Never after create | Reference |
| `slots[].slot` | The slot key the plan uses | Secrets wrapper | Never after create | Identity of the slot |
| `slots[].secret` | The Daytona Secret name | Secrets wrapper | Never after create | Reference to the Secret |
| `slots[].hosts` | The hosts the Secret may be sent to | Secrets wrapper, from the plan | Never after create | Policy |
| `slots[].placeholder` | The text that stands for the value inside the sandbox | Daytona, recorded by the wrapper | Never after create | Reference |

The values are examples; the implementer takes the slot key and placeholder formats from
`daytona-secret-plan.ts`. If labels are too small, the api stores the same object keyed by
sandbox id, and the runner reads it with the runner token.

### The records-incomplete flag

**Before.** A set in one pod's memory (`persist.ts:213-228`). No wire field.

**After.** The runner posts the fact when a record ingest fails all its retries:

```json
POST /sessions/records/incomplete
{ "session_id": "019d952f-0000-0000-0000-000000000001", "turn_id": "019d952f-0000-0000-0000-000000000004" }
```

The api stores the time in a new nullable column, `records_incomplete_at`, on the session's row
in `session_sequence_cursors`. The records query returns it next to the records:

```json
{ "count": 42, "records": [ ... ], "records_incomplete": true }
```

| Field | What it is | Owner | Changes | Role |
| --- | --- | --- | --- | --- |
| `records_incomplete` | The record log has lost at least one event | Api, from the runner's report | Once per session; never clears | Integrity metadata of the record log |

The reasons:

- **Not in `session_streams.flags`.** That field is a typed mirror of three Redis booleans
  (`is_alive`, `is_running`, `is_attached`). The api rebuilds it from Redis on every beat and
  every read (`streams/service.py:849-853, 977-994`), so a fourth value would be overwritten. Its
  role, liveness, also differs from this one.
- **With the record log.** The fact describes the record log, and the reconstruct step already
  queries the record log. The flag arrives on the read it already makes.
- **A timestamp in storage, a boolean on the wire.** The time helps an operator; the reader needs
  only yes or no.

## What a user experiences after each stage

### After stage 1 (the minimal design)

| Situation | What the user sees |
| --- | --- |
| A follow-up reaches the pod that holds the session | A warm hit, as today, plus one api round trip. |
| The latest-row read fails at a warm hit | The turn fails with an error that names the cause. The next message can warm-hit again. |
| A follow-up reaches the other pod, Daytona path | A correct reply after a fresh sandbox create and a session/load: tens of seconds, to be measured. |
| A follow-up reaches the other pod, in-process path | A fast reply; the first tool call waits for a new command sandbox. |
| The next message returns to the first pod | The pod sees the newer turn, evicts its entry, and creates a fresh sandbox again. No stale reply. |
| Stop during a turn | The turn stops at once, from the api directly to the turn's pod. |
| Stop on a parked approval | The approval closes at once, on the pod that holds the prompt. |
| A delayed Stop meets a newer parked approval | The newer approval stays open; the Stop settles `obsolete`. |
| An approval answer reaches the other pod | The call runs without a second question, after a fresh sandbox create. |
| Kill | Every labelled sandbox of the session is deleted, from any pod. A sandbox created before the labels is deleted only if Kill reaches its owner. |
| A deploy or node drain during a turn | The turn finishes, up to the wait limit. New turns go to the other pod. Stop and Kill keep working on the leaving pod. |
| A deploy with a parked approval | The live prompt is cancelled. The answer runs on a fresh sandbox through the stored decision. |
| A pod crash during a turn | The turn is lost after 90 seconds, as today. The pod's sandboxes live up to 45 minutes. |
| The same turn id reaches two pods | The second pod is refused, and its final beat changes nothing. |

### After stage 2 (design B)

| Situation | What the user sees |
| --- | --- |
| A follow-up reaches the other pod, Daytona path | A reply after a sandbox stop and start plus a session/load with the baseline, or a reconnect plus a session/load with live adoption: seconds, not a create. |
| The next message returns to the first pod | The pod evicts its entry without touching the sandbox and adopts it again. |
| A deploy with a parked approval | The sandbox is kept. The answer adopts it on any pod and loads the session. |
| The first turn after a restart | The new process adopts the sandbox; no fresh create. |
| A turn longer than 15 minutes | Keeps its sandbox, because the runner refreshes Daytona activity during the turn. |
| An idle session | Its sandbox stops after Daytona's interval, 2 or 3 minutes, instead of 120 seconds. |
| Kill | Deletes every labelled sandbox and, from the manifest, its Secrets. |
| A pod crash | Its sandboxes are adoptable by the next turn on any pod. |

Rows not listed match stage 1.

### At one replica (compose, Railway, self-hosted Helm)

Stage 1 changes little that a user sees. A crashed runner's replacement no longer waits for an
owner key. Stop goes to the same single URL. A failed latest-row read now fails a warm turn. Kill
also deletes labelled sandboxes that no pool entry holds, such as a stopped one. Stage 2 removes
the fresh sandbox create after every restart.

## Alternatives considered

### Hash routing in the callers (the issue's option A)

A headless Service exposes every pod address. A consistent-hash resolver in
`api/oss/src/core/sessions/streams/runner_client.py` and in `services/oss/src/agent/app.py`
picks a pod by session id over a sorted list of ready pods.

It keeps warm hits near 100 percent while the set of pods is stable, and Stop goes straight to a
pod. But every deploy and every scale event changes the pod list, so it still needs all five
common changes. It adds a resolver in two code bases, which can disagree while the list
changes. And it hides the miss cost instead of removing it: when the pod set changes, the session
lands on a new pod and pays the same fresh create. It is not recommended. A routing hint could
be added later if stage 2 is delayed.

### Fan-out of Stop to every pod

The api resolves every pod address and posts `/cancel` to each; the holder answers 202. Stop
keeps its meaning and its speed. The api gains pod discovery and handling for partial failures,
and every Stop costs one request per pod. The turn binding gives the same result with one
request and no discovery, so fan-out is not recommended.

### Stop delivered through the heartbeat (rejected)

The api would return pending Stop commands in the heartbeat answer of the beating turn, and the
runner would apply them. The product moved Stop off the heartbeat on purpose (#6503), and this
alternative would move it back. Its downsides:

- **Latency up to one beat interval.** That is 30 seconds today. A shorter interval only reduces
  it.
- **Six times the heartbeat traffic** at a 5-second interval. Every beat writes
  `session_streams.updated_at`.
- **A parked approval does not beat.** The api would have to settle that Stop alone. The
  harness would keep waiting on its open prompt in the pod until the pod's timer fired.
- **The explicit "acted at once" guarantee is lost.** The session-control work established that
  the runner acts on a Stop immediately and reports the outcome. A beat-paced Stop cannot promise
  that.

Stop stays direct and immediate.

### Forward to the holder

A pod that receives `/run` or `/cancel` for a session that another live pod holds forwards the
request there, through a streaming proxy or a redirect that the SDK follows. It keeps warm hits
near 100 percent while pods are stable. It adds a streaming proxy, a liveness check on the
named pod, a fallback when that pod is gone, and a second record of who holds the session. It is
option A with a table instead of a hash, and it is not recommended.

### Trade-offs

The numbers in this table are estimates from the research, not measurements.

| | Minimal (stage 1) | Design B (stage 2) | Hash routing (option A) |
| --- | --- | --- | --- |
| Correct at N pods | Yes | Yes | Only with the five common changes |
| Follow-up on the other pod | Fresh sandbox, tens of seconds, half of follow-ups at 2 pods | Stop and start (baseline) or reconnect, plus load: seconds | Near zero while pods are stable; fresh sandbox when they change |
| Stop | Direct to the turn's pod, immediate | Same | Direct, immediate; wrong pod when the set changes |
| Kill | Labelled sandboxes from any pod; pre-label ones only by their owner; Secrets only by their creator | Same, plus every sandbox's Secrets from the manifest | Same as stage 1 |
| Failed freshness read | The turn fails with a clear error | Same | Same, because it needs the same check |
| Code | About +250 lines; owner key and local probe removed | About +400 to +600 more; park-to-stopped, the wrapper's stop paths, and delete-on-reconnect removed | About +200 lines, on top of the minimal design |
| New dependencies | Pod IP reachable from the api; runner token on every beat; Daytona list by label | Label limits or an api manifest store, SDK calls reset autostop, daemon behaviour | Headless Service, two resolvers |
| Spikes | Measure the miss cost | Two, including the manifest size | None |
| Rollout | Chart waits for every runner to bind turns | Two releases: no-stop rule first, adoption second | Resolver and chart together |
| Risk area | The heartbeat handler, `_deliver` | Secrets wrapper, sandbox lifecycle | Resolvers that disagree |

## Recommendation and staging

**Stage 1: correctness.** Ship the five common changes with the minimal rule. Two pods are safe.
Stop is direct and exact. Kill reaches every labelled sandbox. Deploys stop killing running
turns.

**During stage 1: gather the data for design B.** Run the two spikes and measure the miss cost of
stage 1 on the GKE stage. Design B stays fully designed in this plan.

**At the end of stage 1: decide on design B with that data.** Design B is the design the issue
asked for, and it removes the restart cost that every session already pays. It is also larger
than it first looks. It needs a slot manifest, a credential write on adoption, a two-release
rollout, and changes to every stop path of the Secrets wrapper. The miss cost and the spikes
say whether that work pays for itself.

Hash routing is not recommended. It still needs the five common changes, adds a resolver in two
code bases, and hides the miss cost instead of removing it.

## Verification plan

### Spikes and measurements first

1. The daemon with two ACP servers, and whether a stop ends the old pod's adapters (see "Two
   spikes that gate design B").
2. Daytona semantics: autostop on SDK `get` and on preview traffic, label limits and the
   manifest size, list latency, and whether the Secret list returns placeholders and hosts.
3. The miss cost of stage 1 on the GKE stage: time to first reply on a warm hit and on a fresh
   create.

### Unit tests

Runner tests use vitest under `services/runner/tests/`. Api tests use pytest under
`api/oss/tests/pytest/unit/sessions/`.

- The binding: a second replica is refused on any beat; a refused replica's final beat leaves
  `running` alone; a beat without a valid runner token binds an empty address.
- Stop: the first delivery and redeliveries post to the bound address; a 404 settles at once; a
  transport failure follows the abandoned-command path; a parked Stop goes to the parking pod.
- A delayed Stop against a newer parked approval answers `obsolete`.
- The warm cache check: equal `turn_index` gives a warm hit, including after an approval resume;
  a newer row gives an eviction and the cold path; a failed read fails the turn.
- A resume 409 is silent; a fresh 409 ends the turn, evicts as `continuity-invalid`, and makes
  no cold retry.
- The minimal rule: the reconnect steps create fresh for an id this process did not create, with
  opaque Secrets on and off; the wrapper never deletes an unknown sandbox.
- The incomplete flag written on one pod is read on another.
- Kill: deletes every labelled sandbox, not-found is success, and Secrets only for owned
  allocations; labels do not change the create fingerprint.
- Shutdown: `/run` and `/stream` answer 503 while `/cancel` and `/kill` work; the wait covers
  Daytona turns; parked prompts get a settled cancel; the disposition follows the design.
- The chart renders `Recreate` for the local provider and fails for the local provider with
  `replicas > 1`.
- Design B, "Daytona does all the stopping": an eviction makes no stop call; the wrapper's
  `pause()`, cleanup timer, and retries make none either; the in-turn refresh calls the SDK on
  schedule.
- Design B, "The sandbox describes itself": the entry is rebuilt from the manifest, a slot-set
  mismatch is caught, and the credential values are written before the turn runs.

### Two-process test

With a fake api and a fake daemon, run two runner processes:

1. Park a session on A.
2. Continue it on B.
3. Send the next message back to A. A must evict and take the cold path.
4. Press Stop while B runs. The Stop must reach B directly.
5. Park an approval on A and press Stop. The Stop must reach A directly.
6. Park a newer approval on A, then deliver a delayed Stop for the older turn. The approval must
   stay open.
7. Send the same turn id to A and B. B must be refused, and B's final beat must leave A's
   `running` in place.
8. Send Kill to B. Every labelled sandbox must be deleted.

### The in-process path from A to B to A

The in-process path keeps more state in the pod: the native Pi session, the local transcript
cache, and the command sandbox. Run the full path:

1. Turn 1 on A, with a tool call, so A creates a command sandbox.
2. Turn 2 on B. B must restore the transcript from the object store, select the native session
   from the latest row, and create its own command sandbox.
3. Turn 3 on A. A must evict its live Pi session, ignore its local transcript cache, restore the
   transcript that B saved, and select the native session from the latest row.
4. Check that the stored transcript holds turns 1, 2, and 3.

### Approval recovery across pods

Park an approval on A. Answer it so that the continuation reaches B. Check that B sees every
earlier turn in the harness transcript before the model issues the call again, on the Daytona
path and on the in-process path.

### Release gate

The `agent-release-gate` skill names a two-replica journey as a follow-up
(`.agents/skills/agent-release-gate/resources/qa_product.py:1592`). Add it, plus these cells:

- a duplicate `/run` with the same turn id on two pods, where the second is refused;
- the final beat of the refused runner, which must not end the admitted turn;
- the #7287 check: an answered approval row survives the turn-start sweep on a pod that holds
  nothing.

### Live check on the GKE stage

With `replicas: 2`:

1. A rolling deploy during a turn: the turn finishes, and a Stop sent during the drain reaches it.
2. A node drain during a parked approval, then the answer.
3. The miss cost in stage 1, and in stage 2 if it ships.
4. Stop latency.
5. Daytona autostop on a long turn.

## Implementation order

Each step says what reverts it. Not every step is independent; the dependencies are named.

1. **Spikes and measurements.** Run the two spikes for design B and measure the stage 1 miss cost
   on the GKE stage. File the autostop issue. Nothing to revert.
2. **"Verify the warm cache before use" and the minimal rule.** Revert: a plain revert.
3. **"Bind the turn to its pod" and "Stop goes to the turn's pod", together,** with the
   target-turn check for a parked Stop. Stop routes by the binding, so they ship as one pull
   request. A turn admitted before the deploy has no binding, and its Stop goes to the Service
   URL as today. Revert: as a unit; the owner key and the Service URL delivery return.
4. **Drop the heartbeat response field `replica_id`,** one release after step 3. Revert: a plain
   revert.
5. **"Kill by label inventory" and "Drain, then cancel, then tear down".** Revert: a plain revert.
   Sandboxes created while the labels existed keep them, which does no harm.
6. **Chart: `RollingUpdate` for remote providers, `replicas: 2` on GKE, the pod IP and pod name.**
   This step needs steps 2, 3, and 5 in production. Every runner pod must run the version that
   binds turns, and no turn that an older runner admitted may remain. The device-login decision must
   be settled first. Revert: set `replicas: 1` and `Recreate` in the values.
7. **If Mahmoud decides for design B: "Daytona does all the stopping",** in its own release,
   with adoption still off. Revert: a plain revert, but only while adoption is off.
8. **"The sandbox describes itself",** in a later release, after every process of the step 7
   version has replaced the processes before it. Revert: a plain revert. Revert this step before
   step 7, never the other way round, because the old stop paths would stop adopted sandboxes.

## Decisions for Mahmoud

### Decision 1: how Stop reaches the turn's pod

**Today.** Stop goes to the Service URL. At one pod it always reaches the right pod. At two pods
half of all Stops reach the wrong pod and settle `lost`.

**Option 1: route by the turn's recorded pod address.** The binding names the pod at admission,
and the api posts to it. Stop stays direct and immediate, and its meaning does not change. Side
effects: the api must reach pod IPs, and a NetworkPolicy that blocks that traffic breaks Stop.
Every beat carries the runner token, so that the api can trust the address. The chart can set two
replicas only after every runner binds turns.

**Option 2: fan-out to every pod.** Stop stays direct and immediate. The api gains pod discovery
through a headless Service and partial-failure handling, and every Stop costs one request per
pod.

Heartbeat delivery is not an option; it is rejected under "Alternatives considered".

**Recommendation: option 1.** It reaches the right pod with one request, and the binding it
needs also fixes the double admission of one turn.

### Decision 2: when to decide on design B

**Today.** Every restart costs each session a fresh sandbox, and in stage 1 a second pod does the
same on half of all follow-ups. Design B removes both costs. Its price is a slot manifest, a
credential write on adoption, a two-release rollout, and changes to every stop path of the
Secrets wrapper.

**Option 1: commit to design B now.** Plan its two releases behind stage 1. Pods become
interchangeable as early as possible. Side effects: the larger work is committed before anyone
has measured the miss cost. It is also committed before the spikes say whether stop-before-adopt
is needed and whether the manifest fits on a label.

**Option 2: ship stage 1, gather data during it, and decide on design B at its end.** Run the two
spikes and measure the stage 1 miss cost on the GKE stage while stage 1 is built and rolled out.
Design B stays fully designed in this plan. Side effects: the restart cost and the miss cost stay
for the length of stage 1, and design B starts later if the data supports it.

**Option 3: add a routing hint instead of B.** Follow-ups mostly reach the same pod while pods are
stable. It adds a resolver in two code bases, and it does nothing for the restart cost.

**Recommendation: option 2.** The spikes and the measurement run in parallel with stage 1, so the
decision costs no calendar time. Design B is now larger than a naming change, and the data shows
whether a miss costs enough to pay for it.

### Decision 3: shutdown order

**Today.** At SIGTERM the runner cancels every running turn within about 5 seconds and deletes the
sandboxes of running turns and parked approvals.

**Option 1: drain, then cancel with a settled wait, then tear down.** The pod refuses new turns
on `/run` and `/stream`, and keeps `/cancel` and `/kill` open. It lets every admitted execution
finish, up to the grace period. It cancels the rest, parked prompts included, and waits for each
cancel to settle. Stage 1 then deletes idle and parked sandboxes; stage 2 leaves them for Daytona
to stop. Side effects: a rolling deploy takes up to about ten minutes at two pods, and a late
request can get a 503.

**Option 2: keep today's shutdown.** Every deploy and node drain kills running turns.

**Recommendation: option 1.** With two pods, the other pod takes new turns while the leaving pod
finishes its own, so the wait costs users nothing.

### Decision 4: hosted device login at two pods

**Today.** A device-login attempt is a running poll loop with its state in one pod's memory. The
api's later poll can reach the other pod, which does not know the attempt.

**Option 1: move the attempt's state to the api.** The pod that runs the poll loop writes the
attempt's status to the api. The api answers the user's polls from that record. Side effects:
a new api record, and a design for a pod that dies mid-attempt.

**Option 2: disable hosted device login on deployments with more than one runner pod,** with a
clear error, until option 1 lands. Side effect: users of those deployments cannot connect a
subscription by device login.

**Recommendation: option 1 if it is small; otherwise option 2 with a clear error.** Option 1
keeps the feature on every deployment. Option 2 gives the user a clear error, instead of a poll
that reaches a pod that never saw the attempt. Either must land before the chart sets
`replicas: 2`.

## Findings outside this design to file as issues

- **Daytona autostop ignores preview traffic.** By the SDK documentation, a turn longer than 15
  minutes can lose its sandbox (research.md section 13.9). "Daytona does all the stopping" fixes
  it. File it on its own, because stage 2 is not scheduled.
- **A single-pod restart deletes every parked sandbox on the next turn** (research.md section
  13.1). This is today's behaviour at one replica.
- **The same `turn_id` on two pods is admitted twice** (research.md section 13.6). "Bind the turn
  to its pod" fixes it.

## Follow-ups, not in this change

- **A routing hint,** as a later optimization if stage 2 is delayed.
- **A HorizontalPodAutoscaler** for the runner.
- **Device-login state in the api,** if decision 4 picks option 2 first.
- **Daytona Secret reconciliation beyond "The sandbox describes itself":** a sweep that lists
  Secrets by prefix and deletes those of sandboxes that no longer exist (#6438).
