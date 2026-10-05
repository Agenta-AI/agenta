# Plan: runner replicas

Terms in this file are defined in the [README glossary](README.md#glossary). The problem, what a
user sees today, and the four failure scenarios are in [context.md](context.md).

The plan has two stages:

- **Stage 1, the minimal design (private sandboxes).** Five common changes, plus one rule: a pod
  never deletes a sandbox it did not create. Two pods become safe. A follow-up on the other pod
  still costs a fresh sandbox.
- **Stage 2, design B (any pod adopts any sandbox).** The sandbox carries the facts that a pod
  needs to adopt it, and Daytona alone stops idle sandboxes. A follow-up on the other pod costs
  seconds, and a restart no longer costs a fresh sandbox.

The five common changes are needed by both designs and by every alternative:

1. Bind the turn to its pod.
2. Stop goes to the turn's pod.
3. Verify the warm cache before use.
4. Kill every recorded sandbox.
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
another pod's sandbox. Design B lets every pod use every sandbox, and takes the power to stop
one away from all pods.

## Changes common to both designs

### Bind the turn to its pod

#### Today

The owner key is a session-level lease: 120 seconds, never taken from a live replica, handed to
a replica with no running turn. A chain of code exists only for it (see "The owner key and the
direct Stop" above). It does not route anything.

It also fails at its one job. Two pods that beat the same `turn_id` are both admitted. The
departed-owner path treats a matching turn id as the caller's own lock. So the key passes between
the two pods on every beat, and neither turn is interrupted (research.md section 13.6).

#### The change

1. **The first heartbeat binds the turn to the pod.** The script that admits a turn on its first
   beat (`ACQUIRE_ALIVE_WITH_START_LUA`, `api/oss/src/dbs/redis/sessions/contract.py:248-259`)
   also writes a new write-once key:
   `bound:<project_id>:session:<session_id>:turn:<turn_id>`, with the value
   `<replica_id>\x1f<replica_address>`. It writes the key with `NX`.
2. **A second pod is refused.** When the key already exists and names a different replica id,
   the script refuses the beat with `is_current_turn: false`. The runner already reads that
   answer on the first beat as a refused admission and stops before it touches the sandbox
   (`services/runner/src/sessions/alive.ts:385`).
3. **The binding lives as long as the turn.** The key has the TTL of `alive` (3600 seconds) and
   is refreshed with it. So it still names the pod of a parked turn, which holds `alive` without
   `running`.
4. **The runner reports its address.** The heartbeat request gains `replica_address`. On
   Kubernetes it is `http://<pod IP>:8765`. The chart passes the pod IP through the downward API
   (`status.podIP`). On compose and Railway the field is empty, and the api reads an empty
   address as "use the Service URL".
5. **The replica id becomes the pod name.** The chart sets `AGENTA_RUNNER_REPLICA_ID` from
   `metadata.name` at every replica count. The id stays a label and the claim identity in
   `session_commands.claimed_by`.
6. **The owner key goes.** Delete the key and every piece of code that exists for it. The orphan
   sweep keeps its turn-scoped release and the `superseded` record, and drops the owner compare.

The binding is a new key, not a new value inside `started:<turn>`. The `started` key holds epoch
milliseconds as a plain integer string. Two readers parse it as a number:
`record_turn_start` (`locks.py:315-345`) and the late-Stop guard in `DISPLACE_TURNS_LUA`
(`contract.py:277-283`). The binding also has a different role: `started` is a time that a guard
compares, the binding is a route.

#### Why this and not the alternatives

The alive and running keys decide which turn runs. The owner key tried to say which pod serves a
session, and a session is the wrong unit: a session moves between pods by design, a turn never
should. One write-once record per turn gives the api an exact address for Stop. It needs no
renewal of its own, no expiry of its own, and no takeover rule.

The alternatives:

- **Keep the owner key and add the address to it.** The key would still be a session-level
  lease, with the renewal, expiry, and takeover steps that cause #5611 and #6765. It would also
  still let two pods run one turn.
- **Store the address in the session_turns row.** The runner appends that row after it acquires
  the environment, which is seconds after admission. A Stop in that window would find no
  address. A Postgres column would also outlive the turn and need clearing.
- **Share one replica id across pods.** Every pod then claims every session (#5404).

#### Deleted

- Redis: the `owner:` key, its claim script, `claim_owner_value`, and the claim helpers in
  `contract.py` and `locks.py`.
- Api: `_reclaim_affinity_from_a_departed_replica` and the owner branches of the heartbeat in
  `streams/service.py`; the owner force-clear in Kill; the request field `release_owner` and the
  response field `replica_id`; the owner compare in the orphan sweep.
- Runner: `ownedSessions` and the shutdown release in `alive.ts`; `LocalSandboxNotOwnerError`.
- Chart: the `replicas == 1` condition around `AGENTA_RUNNER_REPLICA_ID`.
- Tests: the owner-key tests listed in research.md section 9.

#### Added

The `bound:` key in the admission script, the `replica_address` field, two downward-API entries
in the runner Deployment (`metadata.name`, `status.podIP`), and one runner setting for the
address (`AGENTA_RUNNER_REPLICA_ADDRESS`).

#### Costs and side effects

- **The api trusts an address that a pod reports.** The runner is trusted infrastructure: it
  already authenticates its outcome reports with the runner token. The address is internal to
  the cluster.
- **A pod IP can be reused.** After a crash, Kubernetes can give the same IP to a later pod. A
  Stop to that pod gets 404 `not_held`, which the existing path handles.
- **The local provider loses its runtime refusal on a second runner.** The chart makes that state
  impossible to deploy instead (see "Drain, then cancel, then tear down"). The release gate
  matches the text "is not the owner of session", and a Codex QA script matches "single runner"
  (#6446). The same pull request updates both.
- **One more key per turn in the volatile Redis.** It is small and expires with `alive`.

#### Verification

- Api unit test: a first beat from a second replica for the same turn is refused.
- Api unit test: the heartbeat works with no owner key, and a parked turn keeps its binding.
- Runner unit test: a refused first beat stops the turn before the sandbox is touched.
- Release gate: the `cold2` journey replaces a runner with SIGKILL and must pass without waiting
  120 seconds for an owner key.

### Stop goes to the turn's pod

#### Today

The api posts `/cancel` to the Service URL, which picks a pod at random. A 404 means `not_held`.
Three failed deliveries settle the command `lost` (#6634; the fix, #6780, is open). What the
Stop does once it reaches the right pod is correct, and it stays:

- the immediate abort through `applyCommand`;
- the outcome report;
- the parked Stop, which rejects the gates and waits for the cancel to settle.

#### The change

1. `request_cancel` resolves the target turn, as today.
2. It reads that turn's binding.
3. It posts `/cancel` to `replica_address` instead of the Service URL.

Everything after the address is unchanged. `cancel_runner_execution` and `kill_runner_sandbox`
(`api/oss/src/core/sessions/streams/runner_client.py:32,98`) read `env.runner.internal_url`
today and take no URL. Each gains an optional `base_url` that falls back to the Service URL.

The edge cases:

- **A Stop on a parked approval.** The binding still names the pod that holds the parked
  prompt, so `parked.stop()` runs there as today.
- **The address is empty** (compose, Railway). The api posts to the Service URL, which is the
  one pod.
- **No binding exists.** Either no pod has admitted the turn yet, or a runner of the previous
  version admitted it during a deploy. The api posts to the Service URL, as today. In the first
  case every pod answers 404 `not_held`, which is also today's answer for that moment.
- **The pod is gone.** The post fails, and the api treats it as `not_held`. The existing
  redelivery and `lost` path runs. Once #6780 merges, an undeliverable Stop on a beating turn
  is parked instead.

The address is reachable as the chart stands. The runner listens on `0.0.0.0`
(`hosting/kubernetes/helm/templates/_helpers.tpl:160-163`). The chart's only NetworkPolicy
covers the bundled data stores, is off by default, and does not select the runner pod. So
`http://<pod IP>:8765` is reachable from an api pod.

#### Why this and not the alternatives

The only new fact a Stop needs is "which pod". The binding records it at admission. The change
adds no fan-out, no DNS discovery, no hash, and no proxy, and it does not change what Stop does.

The alternatives:

- **Send Stop to every pod.** The api resolves every pod address through a headless Service and
  posts to each. Stop keeps its meaning, but the api gains pod discovery and partial-failure
  handling, and every Stop costs one request per pod.
- **Deliver Stop through the heartbeat.** Rejected; see "Stop delivered through the heartbeat"
  under the alternatives.
- **Hash the session id to a pod.** Two code bases need the same resolver, and it picks the
  wrong pod whenever the set of pods changes.

#### Deleted

Nothing.

#### Added

One Redis read in `request_cancel`, and the `base_url` parameter on the two runner-client calls.

#### Costs and side effects

- **The api must reach pod IPs.** Inside one cluster it can. A NetworkPolicy that blocks api to
  runner traffic would break Stop; the chart documentation must say so.
- **Compose and Railway see no change**, because the address is empty there.

#### Verification

- Api unit test: Stop posts to the recorded address.
- Api unit test: an unreachable address falls into the `not_held` path.
- Api unit test: a Stop on a parked approval goes to the pod that parked it.
- Release gate: a Stop of a turn that runs on pod B, sent while pod A also runs.

### Verify the warm cache before use

#### Today

The warm-hit decision compares fingerprints of the incoming request with the pool entry
(research.md section 3.6). Nothing compares the entry with the durable log. The playground sends
only the last user message, so the history fingerprint check is skipped for it (research.md
section 12.7).

The turn-start write of the session_turns row ignores every failure, including a 409 for a
duplicate `turn_index` (research.md section 12.3). An approval resume legitimately appends the
same index as its paused turn, so its 409 is expected (research.md section 13.8).

The marker that stops a pod from rebuilding history from a record log with a hole is a set in
one pod's memory (research.md section 13.2). Another pod does not see it.

#### The change

**Before a warm hit, read the latest row.** This covers the `hit-continue` branch and the
approval-resume branch in `services/runner/src/lifecycle/session-coordinator.ts`.

1. Read the latest session_turns row with the existing query, using the turn's authorization.
2. Compare the row's `turn_id` with the turn that parked this entry.
3. On a mismatch, evict the entry with the existing reason `continuity-invalid` and take the
   cold path.
4. On a match, or when the read fails, take the warm hit as today.

The check has no race. It runs inside the pod's own admitted turn, which holds `alive` and
`running`, so no other pod can append a row until this turn ends.

**Make the 409 benign only for a resume.** The runner knows before the append whether the turn
is a resume (`opts.resume`, `settleApprovalsThenPrompt`, `carriesApprovalReplyOnly`;
research.md section 13.8).

- For a resume, the 409 stays silent, as today.
- For a fresh prompt, the runner logs an error and fails the turn with an error that names the
  cause: another runner already wrote this turn index. It does not run the `failed-turn` cleanup
  that deletes the environment.

The append happens before the prompt (research.md section 12.3), so a failed fresh append
never sends a stale prompt. After the read above, a fresh-prompt 409 means either a failed read
or a bug.

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
- **Read the turn log.** It already records which turn came last, and it is the record every
  pod writes.

The design reads the turn log. On a failed read it takes the warm hit, because the 409 then
catches a stale entry before the prompt. On a mismatch it uses the existing eviction reason, so
the teardown follows today's rules for that reason. What that teardown does to the sandbox
differs by design: the minimal design stops the pod's own sandbox, and design B touches no
sandbox at all.

#### Deleted

The silent `.catch(() => {})` on the turn-start write for the fresh-prompt case
(`run-turn.ts:764`, `session-continuity-durable.ts:262`).

#### Added

The read before a warm hit, the resume test before the append, the incomplete-flag write and
read, and the api route and column for the flag.

#### Costs and side effects

- **One more api round trip per warm hit,** a few milliseconds.
- **A fresh-prompt 409 now shows the user an error.** Today the user gets a reply from the wrong
  history instead.
- **The incomplete flag adds one write on a rare path.** If that write also fails, only the pod
  that dropped the record knows, as today.

#### Verification

- Runner unit test: the latest row is this pod's turn, so the turn is a warm hit.
- Runner unit test: the latest row is another pod's turn, so the pod evicts and takes the cold
  path.
- Runner unit test: the read fails, so the turn is a warm hit.
- Runner unit test: a resume 409 is silent; a fresh 409 fails the turn and deletes nothing.
- Runner unit test: a flag written on one pod stops a reconstruct on another pod.
- Implementer check: confirm that `EntityCreationConflict` maps to HTTP 409. research.md section
  12.3 did not read that line.

### Kill every recorded sandbox

#### Today

`POST /kill` drains the receiving pod's pool entry and answers 200, whether or not it found
anything (research.md section 6.3). The api never reads `session_turns.sandbox_id` (research.md
section 6.4).

Two gaps sit under that. The in-process command sandbox is created on the first tool call, and
its id is never written to the row of the turn that created it (research.md section 13.7). And
the two providers store different shapes in one column: `daytona/<raw>` on the Daytona path and
`<raw>` on the in-process path.

#### The change

1. **Record the sandbox id when it is allocated.** When the in-process path creates a command
   sandbox, the runner writes its id onto the current turn row. Both providers store one shape,
   `daytona/<raw>`, which the reconnect already requires.
2. **The api collects every id.** Kill reads the distinct `sandbox_id` values across all the
   session's rows. A session can own several sandboxes over time: in the minimal design, each
   move between pods creates one.
3. **The api sends the list to the turn's pod first.** It reads the binding of the session's
   `alive` turn before it ends the turns. It posts `/kill` with `sessionId`, `projectId`, and
   `sandboxIds` to that `replica_address`, so the holder drains its pool. If that call fails, or
   no binding exists, it posts the same body to the Service URL.
4. **The receiving pod deletes each id.** It drains its local entry and its in-flight sandboxes
   as today. Then it deletes every id in the list. For an id whose Secret allocation it holds,
   it runs the Secret-aware cleanup. For any other id, it deletes the sandbox by id
   (`daytonaWithLifecycle.deleteSandbox`, `daytona-provider.ts:318-326`). Not-found counts as
   success.

In design B, Kill finds the sandboxes by their labels instead, and deletes their Secrets by
derived name (see "The sandbox describes itself").

#### Why this and not the alternatives

- **Let the api call Daytona.** The api has no Daytona client and no Daytona credentials. The
  runner has both.
- **Send `/kill` to every pod.** This needs pod discovery in the api, and it still misses a
  sandbox that no pod holds, such as a stopped one.
- **Delete only the latest row's sandbox.** It misses the older sandboxes that pod moves leave
  behind.

The api sends the ids because it owns the turn log. At `/kill`, the runner holds only the runner
token, and the turns query needs a project credential.

#### Deleted

Nothing.

#### Added

- The id write at allocation.
- A one-time data migration that adds the `daytona/` prefix to ids without one.
- The distinct-id read in the api and the `sandboxIds` field.
- The delete loop in the runner.

#### Costs and side effects

- **Kill becomes best-effort over a list.** One failed delete does not stop the others. The
  failure is logged, and Daytona's autostop and autodelete remove the sandbox later.
- **A sandbox still being created has no row yet.** Its pod's own lifecycle or Daytona removes
  it.
- **Secrets of a sandbox deleted by another pod stay orphaned.** Only the creating pod knows
  them. They remain until design B's derivable names, or #6438.

#### Verification

- Runner unit test: a pod with no entry deletes every listed id.
- Runner unit test: not-found counts as success.
- Runner unit test: the in-process path records its command sandbox id at create.
- Api unit test: Kill sends every distinct id, to the bound pod first.
- Release gate: Kill sent to the pod that does not hold the session leaves no sandbox.

### Drain, then cancel, then tear down

#### Today

At SIGTERM the runner (research.md sections 12.5 and 13.5):

1. Interrupts in-process turns within 5 seconds.
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

1. **Drain.** Set a flag. `/run` answers 503 from now on. Kubernetes removes the pod from the
   Service endpoints on its own schedule, so the pod must refuse new work itself.
2. **Wait.** Let running turns finish, for at most the grace period minus a margin. The chart
   passes the limit, for example 230 seconds out of 300.
3. **Cancel.** Cancel what still runs with `cancelHarnessTurn`, and wait for the settled result.
4. **Tear down.** In the minimal design, delete every sandbox the pod holds. In design B, delete
   a sandbox whose cancel did not settle, and leave every other sandbox running. Daytona stops it
   after its idle interval, and any pod can adopt it before or after that.
5. Exit.

The 5-second budgets of today's shutdown grow to fit step 2.

The minimal design deletes everything at step 4, idle and parked sandboxes included. No other
process can adopt a sandbox, so a stopped one would only wait 30 minutes for autodelete. The
settled wait still matters there: it lets the harness finish writing its transcript to the
mount, so the next pod's session/load finds a complete history.

Design B does not stop sandboxes at shutdown, for the reason given in "Daytona does all the
stopping": another pod may already use the sandbox, and a stop would end that pod's turn.

The chart:

- `strategy: RollingUpdate` with `maxSurge: 1` and `maxUnavailable: 0` when only remote
  providers are enabled. Kubernetes starts a new pod and waits until it is ready before it stops
  an old one.
- `strategy: Recreate` stays when the local provider is enabled, and the template fails to render
  when `agentRunner.replicas` is greater than 1 with the local provider.
- `AGENTA_RUNNER_REPLICA_ID` from `metadata.name`, and the pod IP from `status.podIP`, at every
  replica count.
- `agentRunner.replicas: 2` in the GKE values. The chart default stays 1.
- The PodDisruptionBudget stays.

#### Why this and not the alternatives

Today a deploy cancels every running turn within seconds. With one pod there was nowhere else
for new turns to go, so waiting gained nothing. With two pods, the other pod takes new turns
while the leaving pod finishes its own. The 300-second grace period exists for this purpose
(#7320).

The alternatives:

- **Keep today's shutdown.** Every deploy and node drain kills running turns.
- **Stop without a settled cancel.** The harness can be cut off mid-write, and the next
  session/load can find a partial transcript. This is the reason today's rule deletes an
  unsettled sandbox (research.md section 12.5).

#### Deleted

The `release_owner` step, the `replicas == 1` condition, and the chart comment that explains
`Recreate` for the runner.

#### Added

The drain flag, the wait with its setting, the settled cancel at shutdown, the disposition by
design, and about ten lines of chart.

#### Costs and side effects

- **A rolling deploy is slower.** Each pod can take up to the grace period to leave, so two pods
  can take about ten minutes.
- **A turn that outlives the wait is still cancelled.** The orphan sweep does not see it as lost,
  because the cancel ends it normally.
- **A late request gets a 503.** A request that reaches the pod after SIGTERM and before
  Kubernetes removes it from the endpoints fails. The 10-second `preStop` delay makes the window
  small. The SDK transport does not retry a 503 today (`ts_runner.py:198`).
- **A parked approval still loses its live prompt.** The prompt dies with the pod. The user's
  answer runs on the cold path through the stored decision, as today.
- **Hosted device login breaks at two pods.** A login attempt lives in one pod's memory, and a
  poll can reach the other pod. The fourth decision covers it.
- **In design B, a leaving pod's sandboxes run a little longer.** They run until Daytona's idle
  interval stops them, 2 or 3 minutes.
- **Compose keeps its own grace.** Docker's default stop timeout is 10 seconds, so on compose
  the wait is as short as the compose file allows.

#### Verification

- Runner unit test: after SIGTERM, `/run` answers 503.
- Runner unit test: the handler waits, then cancels, then tears down. In design B a settled
  cancel leaves the sandbox running, and an unsettled one deletes it.
- Chart test: `Recreate` renders with the local provider, and the render fails for the local
  provider with `replicas > 1`.
- Live check on the GKE stage: a rolling deploy during a turn; the turn finishes.

## The minimal design: private sandboxes

The minimal design is the five common changes plus one rule in the Secrets wrapper: **a pod
never deletes a sandbox it did not create.**

### The rule

- The wrapper's no-entry branch (`daytona-secret-provider.ts:429-439`) reports the failure
  without deleting the sandbox.
- The reconnect steps skip the Daytona reconnect for a sandbox id that this process does not
  hold in its registry. They go straight to a fresh create.
- The other sandbox is left to its owner's pool timer, and to Daytona's autostop (15 minutes
  after the last SDK call) and autodelete (30 minutes after the stop).

With this rule, a pod only ever uses, stops, or deletes its own sandboxes. That is why the warm
cache check can evict with a normal teardown: the sandbox it stops is its own, and no other pod
uses it.

### What a user gets

Two pods are correct. A follow-up on the other pod costs a fresh sandbox create plus
session/load: tens of seconds by estimate, to be measured. At two pods with random routing, that
is half of all follow-ups. It is also the cost that every session already pays on the first turn
after any deploy today.

A session that moves back and forth pays the create each time. Message 2 on pod B creates a
sandbox. Message 3 on pod A finds that pod B wrote the latest turn, evicts its own entry, and
creates another.

### Deleted and added

Nothing is deleted beyond the owner key of the common changes. The rule itself is a few lines in
the wrapper and in the reconnect steps.

### Costs and side effects

- **The miss cost.** A full create on half of all follow-ups at two pods.
- **Two sandboxes per moved session for a while.** The first pod's copy runs until its pool
  timer stops it (120 seconds), or until Daytona autostop when that pod is gone.
- **New Daytona Secrets on every move.** Each fresh create allocates its own Secrets.
- **A crashed pod's sandboxes live up to 45 minutes.** They run until autostop (15 minutes) and
  stay stopped until autodelete (30 minutes). Their Secrets stay orphaned.
- **Park-to-stopped still does not survive a restart.** The restart cost of today stays.

The minimal design does not make pods interchangeable. It makes them safe.

### Verification

- Runner unit test: the wrapper never deletes a sandbox without a registry entry.
- Runner unit test: the reconnect steps create fresh for an id this process does not hold.
- Two-process test: park on A, continue on B, and check that A's sandbox is untouched.

## Design B: any pod adopts any sandbox

### The goal

A follow-up on another pod reconnects to the running sandbox and calls session/load, which takes
seconds. The pod that leaves destroys nothing. A stopped sandbox survives a restart again. Design B
has two parts and two spikes that come before any code.

### The sandbox describes itself (B1)

#### Today

The registry entry holds the Secret allocation (research.md section 13.1). It has the map from
environment variable to Secret name, the placeholders, and the created Secret records with their
Daytona ids. It also has the plan, the create fingerprint, and a generation counter. The
wrapper allocates every Secret before it creates the sandbox. It gives each Secret its own
random name, `agenta_<36 hex>_<ordinal>` (`daytona-secrets.ts:255-260`). Nothing of this is on
Daytona. The Daytona-path create request sets no labels (`provider.ts:95-124`).

#### The change

1. **One allocation id per create.** Before it allocates the Secrets, the wrapper mints one
   random allocation id. Every Secret of that create is named `agenta_<allocation id>_<ordinal>`.
   The ordinal comes from the slot's position in the plan, which a pod derives from the request.
   The names cannot use the sandbox id, because the Secrets exist before the sandbox does.
2. **Labels on the sandbox.** The create request carries four labels (see "The Daytona labels"
   below): `agenta.project`, `agenta.conversation`, `agenta.create_fingerprint`, and
   `agenta.secret_allocation`. They go into the create request after `envVars`
   (`provider.ts:113`).
3. **Labels stay out of the fingerprint.** `daytonaCreateFingerprint` (`provider.ts:249`) hashes
   the create request. Its input must exclude the labels. Otherwise the fingerprint label would
   have to contain itself, and the session labels would change the hash for every session.
4. **Adoption on reconnect.** A pod that has no registry entry for a sandbox:
   1. reads the sandbox's labels;
   2. checks that `agenta.project` and `agenta.conversation` match the request;
   3. computes the create fingerprint from its own request and compares it with the label;
   4. derives the plan and the Secret names from the request and the allocation id;
   5. lists the Daytona Secrets by name and keeps only exact matches, because the SDK's name
      filter matches parts of names;
   6. rebuilds the registry entry and reconnects.
5. **Mismatch or missing labels.** On a fingerprint mismatch, the pod has proven the Secrets, so
   it deletes the sandbox and its Secrets and creates fresh, as the creating pod does today. A
   sandbox without labels, created before this change, follows the minimal rule: fresh create,
   no delete.
6. **Kill by inventory.** Kill lists the session's sandboxes by the labels `agenta.project` and
   `agenta.conversation`, and deletes their Secrets by derived name.

The registry becomes a cache of facts that any pod can derive. The delete-on-missing-entry
branch goes away.

#### Why this and not the alternatives

- **A durable allocation table in the api.** It is a second copy that must be written at create,
  deleted at destroy, and reconciled after every crash. That reconciliation is the whole problem
  of #6438.
- **Derivable names plus labels.** The sandbox is the single source. Reconciliation becomes "list
  sandboxes by label and Secrets by prefix".

The design chooses derivable names plus labels.

#### Costs and side effects

- **Secret names become predictable from the allocation id.** They still protect only the
  mapping. The values stay in Daytona and never reach the plain environment.
- **Label limits are unknown.** The SDK documents no size or count limit. The second spike tests
  it.
- **Sandboxes created before this change are not adoptable.** The first deploy treats them as
  today: a fresh create on the next turn.
- **The placeholders must come back from Daytona.** The adopting pod needs each Secret's
  placeholder and allowed hosts. The second spike checks that the Secret list returns them.
- **The Secrets wrapper is security-adjacent code,** and its naming scheme changes.

### Daytona does all the stopping (B2)

#### Today

The pool timer stops a sandbox at the idle TTL (120 seconds) and deletes it for non-parkable
reasons. Daytona's autostop (15 minutes) catches what the runner misses. With shared sandboxes,
a stale pod's stop would hit a sandbox that another pod now uses: scenario 1 of context.md, made
worse.

#### The change

1. **Eviction releases local resources only.** It closes the client, forgets the entry, and
   removes local folders. It sends no stop and no delete.
2. **Daytona's autostop becomes the idle bound.** Set `autoStopInterval` to 2 or 3 minutes. It
   must stay above the pool's idle TTL, so that a warm hit never finds a stopped sandbox.
3. **The runner feeds Daytona activity during a turn.** Every 30 seconds, with the liveness
   probe, the runner calls `refreshActivity`, which is an SDK `get`. This also fixes the
   15-minute autostop risk of a long turn (research.md section 13.9).
4. **Any pod starts a stopped sandbox.** The reconnect steps already do this.
5. **The park-to-stopped code goes.** The timer-driven `pauseSandbox` and the split between
   parkable reasons for the stop case are deleted. Deletes stay for the non-parkable reasons on
   the pod that runs the turn: `failed-turn`, `aborted`, and Kill.

#### Why this and not the alternatives

With shared sandboxes, no pod can know that its stop is safe. Between its check and its stop,
another pod can start a turn on the same sandbox. The simplest rule is that no pod stops
anything. Daytona already has the idle timer; the runner only has to feed it during turns.

The alternative is a check before every stop, as in "Verify the warm cache before use". It
leaves a window between the check and the stop, and a stop that lands in that window ends
another pod's turn.

#### Costs and side effects

- **The idle bound moves from 120 seconds to Daytona's interval,** 2 or 3 minutes. A delay on
  Daytona's side adds billed minutes.
- **The design leans on one SDK sentence.** The SDK says that SDK interactions reset autostop.
  Whether a read such as `get` counts is not stated; the runner's own comment says "believed".
  The second spike verifies it on a live sandbox.
- **A long turn now depends on the in-turn refresh.** Today it depends on nothing, and by the SDK
  documentation it can lose its sandbox after 15 minutes.

This part needs "The sandbox describes itself". Without it, a pod would adopt a sandbox whose
Secrets it cannot verify.

### Two spikes that gate design B (B3)

1. **The daemon with two ACP servers on one harness session.** Pod A parks a session. Pod B
   reconnects to the same sandbox and calls session/load on the same native session. Observe pod
   A's orphaned adapter: its memory, whether it writes to the transcript file, and what pod A's
   later `session/cancel` or disconnect does to pod B's session. The daemon is upstream
   `rivetdev/sandbox-agent` 0.5.0-rc.2 (research.md section 12.1). The outcome may add a cleanup
   step, for example pod B asks the daemon to close other servers' sessions, if the daemon offers
   that. Or it may force "stop the sandbox before adopting". Then a miss costs a sandbox start,
   which is still far cheaper than a create.
2. **Daytona semantics.** Answer five questions on a live sandbox:
   1. Does an SDK `get` reset autostop?
   2. Does preview traffic reset it?
   3. What size and count limits apply to labels?
   4. How long do a list by label and a list of Secrets by name take?
   5. Does the Secret list return each Secret's placeholder and allowed hosts?

### What design B gives and costs

**Gives:**

- Pods are interchangeable.
- A follow-up on another pod costs a reconnect and a session/load, which is seconds.
- A leaving pod destroys nothing; it leaves its sandboxes for Daytona to stop or another pod to
  adopt.
- A stopped sandbox survives a restart again, so a deploy no longer costs each session a fresh
  sandbox.
- Orphaned Secrets (#6438) become findable by prefix.
- The park-to-stopped timer code and the delete-on-missing-entry branch are removed.

**Costs:**

- Two spikes before any code.
- The Secrets wrapper, a security-adjacent module, changes its naming scheme.
- A migration window in which old sandboxes are not adoptable.
- The idle bound depends on Daytona's timer.
- The daemon's behaviour is outside this repository, so a fix upstream may be needed.
- About 200 to 300 changed lines in the runner, close to zero net after the deletions (an
  estimate). The risk sits in `daytona-secret-provider.ts`, `sandbox-lifecycle.ts`, and
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
| `replica_address` | The URL that reaches this pod | Runner, from the chart | Per process | Routing |

The reasons for this shape:

- **A separate key, not a new value in `started`.** `started` is a time that two readers parse as
  a number. The binding is a route. Different roles get different keys.
- **The same key layout as `started`,** so the key is found the same way and expires with the
  same rule. The name `bound` follows the past-participle style of `started` and `superseded`.
- **The separator `\x1f`** is the one the owner key uses today (`contract.py:56-63`).
- **Write-once.** A binding never changes during a turn, so `NX` makes a second writer a refusal,
  not a takeover.

### The heartbeat request and response

**Request, before:**

```json
{
  "session_id": "019d952f-0000-0000-0000-000000000001",
  "replica_id": "5b1e0c9a-0000-0000-0000-000000000000",
  "turn_id": "019d952f-0000-0000-0000-000000000004",
  "is_running": true,
  "release_owner": false
}
```

**Request, after:**

```json
{
  "session_id": "019d952f-0000-0000-0000-000000000001",
  "replica_id": "agenta-runner-6f9c7d5b8-x2lqp",
  "replica_address": "http://10.8.2.17:8765",
  "turn_id": "019d952f-0000-0000-0000-000000000004",
  "is_running": true
}
```

**Response, before:** `{"stream": {...}, "replica_id": "...", "is_current_turn": true}`.
**Response, after:** `{"stream": {...}, "is_current_turn": true}`.

The reasons:

- **`replica_address` sits next to `replica_id`, flat.** Both describe the calling pod and change
  only when the process changes. A nested `replica: {id, address}` object would read better, but
  it renames a field that every runner version sends, for no second consumer.
- **The address is a URL, not a pod IP.** The URL is the stable concept. The pod IP is the
  Kubernetes mechanism, and compose has none. The runner reads it from
  `AGENTA_RUNNER_REPLICA_ADDRESS`, which the chart builds as
  `http://$(AGENTA_RUNNER_POD_IP):8765`.
- **An empty address means "use the Service URL".** Compose and Railway need no new setting.
- **`release_owner` and the response `replica_id` go.** Both existed for the owner key.
- **No new meaning for `is_current_turn: false`.** A refused first beat is already read as a
  refused admission. The owner-mismatch meaning goes away with the owner key, so the field loses
  one of its three meanings (#6765).

### The `/kill` body

**Before:**

```json
{ "sessionId": "019d952f-0000-0000-0000-000000000001", "projectId": "019d952f-0000-0000-0000-0000000000a1" }
```

**After:**

```json
{
  "sessionId": "019d952f-0000-0000-0000-000000000001",
  "projectId": "019d952f-0000-0000-0000-0000000000a1",
  "sandboxIds": ["daytona/sb-7f3", "daytona/sb-a21"]
}
```

| Field | What it is | Owner | Changes | Role |
| --- | --- | --- | --- | --- |
| `sandboxIds` | Every distinct sandbox id in the session's turn rows | Api, from `session_turns` | Per Kill | Input: the targets |

The reasons:

- **A plural list.** A session can own several sandboxes over its life.
- **The api owns the list.** It owns the turn log, and the runner has no project credential at
  Kill.
- **Each id keeps its provider prefix.** `daytona/<raw>` is the form the reconnect needs and the
  form most rows already hold. The in-process path writes the same form, and a one-time migration
  adds the prefix to the in-process rows that lack it. The runner strips the prefix for the
  Daytona delete and skips any id with another prefix, such as the local provider's.
- **No object per id.** Both Daytona-backed providers delete through the same call. A list of
  objects can replace the strings if a second kind of sandbox ever needs different handling.

### The turn row's sandbox id

The in-process path writes the command sandbox id onto the current turn row when it creates the
sandbox. The turns route gains one update, keyed like the existing complete call:

```json
POST /sessions/turns/sandbox
{ "session_id": "019d952f-0000-0000-0000-000000000001", "turn_index": 1, "sandbox_id": "daytona/sb-c55" }
```

The api sets the column only when it is empty, so a later call cannot rewrite history. Role:
data about the turn, owned by the runner, written once per turn.

### The Daytona labels

**Before.** The Daytona-path create request sets no labels. The in-process command sandbox
already carries `agenta.conversation` (the session id), `agenta.project`, `agenta.credentials`,
`agenta.owner`, and `agenta.deployment` (`command-sandbox.ts:417-423`,
`conversation-registry.ts:74-77`).

**After, on the Daytona path:**

```json
{
  "labels": {
    "agenta.project": "019d952f-0000-0000-0000-0000000000a1",
    "agenta.conversation": "019d952f-0000-0000-0000-000000000001",
    "agenta.create_fingerprint": "3f1c9e0d0000000000000000000000000000000000000000000000000000a7b2",
    "agenta.secret_allocation": "9c4e2a7b0000000000000000000000000000"
  }
}
```

| Label | What it is | Owner | Changes | Role |
| --- | --- | --- | --- | --- |
| `agenta.project` | The project id | Runner, from the request | Per sandbox | Inventory, for Kill and adoption |
| `agenta.conversation` | The session id | Runner, from the request | Per sandbox | Inventory, for Kill and adoption |
| `agenta.create_fingerprint` | The SHA-256 of the image and create request, labels excluded | Runner | Per sandbox | Integrity check before adoption |
| `agenta.secret_allocation` | The random id shared by this sandbox's Secret names | Secrets wrapper | Per sandbox | Reference to the Secrets |

The reasons:

- **The same two inventory keys as the in-process path,** instead of one combined
  `agenta.session = <project>:<session>`. One list query then finds a session's sandboxes for
  both providers, and each value is filterable without parsing. The implementer confirms that the
  in-process `conversationId` equals the session id.
- **The fingerprint is a separate label,** because its role is a check, not an inventory key.
- **The allocation id is a reference, not a secret.** It names the Secrets; it reveals no value.
- **No `agenta.owner` on the Daytona path.** In design B any pod may adopt the sandbox, so a
  creating-pod label would mislead.

### The records-incomplete flag

**Before.** A set in one pod's memory (`persist.ts:213-228`). No wire field.

**After.** The runner posts the fact when a record ingest fails all its retries:

```json
POST /sessions/records/incomplete
{ "session_id": "019d952f-0000-0000-0000-000000000001", "turn_id": "019d952f-0000-0000-0000-000000000004" }
```

The api stores the time in a new nullable column, `records_incomplete_at`, on the session's row in
`session_sequence_cursors`. The records query returns it next to the records:

```json
{ "count": 42, "records": [ ... ], "records_incomplete": true }
```

| Field | What it is | Owner | Changes | Role |
| --- | --- | --- | --- | --- |
| `records_incomplete` | The record log has lost at least one event | Api, from the runner's report | Once per session; never clears | Integrity metadata of the record log |

The reasons:

- **Not in `session_streams.flags`.** That field is a typed mirror of three Redis booleans
  (`is_alive`, `is_running`, `is_attached`). The api rebuilds it from Redis on every beat and every
  read (`streams/service.py:849-853, 977-994`), so a fourth value would be overwritten. Its role,
  liveness, also differs from this one.
- **With the record log.** The fact describes the record log, and the reconstruct step already
  queries the record log. The flag arrives on the read it already makes.
- **A timestamp in storage, a boolean on the wire.** The time helps an operator; the reader needs
  only yes or no.

## What a user experiences after each stage

### After stage 1 (the minimal design)

| Situation | What the user sees |
| --- | --- |
| A follow-up reaches the pod that holds the session | A warm hit, as today, plus one api round trip. |
| A follow-up reaches the other pod, Daytona path | A correct reply after a fresh sandbox create and a session/load: tens of seconds, to be measured. |
| A follow-up reaches the other pod, in-process path | A fast reply; the first tool call waits for a new command sandbox. |
| The next message returns to the first pod | The pod sees the newer turn, evicts its entry, and creates a fresh sandbox again. No stale reply. |
| Stop during a turn | The turn stops at once, from the api directly to the turn's pod. |
| Stop on a parked approval | The approval closes at once, on the pod that holds the prompt. |
| An approval answer reaches the other pod | The call runs without a second question, after a fresh sandbox create. |
| Kill | Every sandbox the session recorded is deleted. |
| A deploy or node drain during a turn | The turn finishes, up to the wait limit. New turns go to the other pod. |
| A deploy with a parked approval | The live prompt is lost. The answer runs on a fresh sandbox through the stored decision. |
| A pod crash during a turn | The turn is lost after 90 seconds, as today. The pod's sandboxes live up to 45 minutes. |
| The same turn id reaches two pods | The second pod is refused at admission. |

### After stage 2 (design B)

| Situation | What the user sees |
| --- | --- |
| A follow-up reaches the other pod, Daytona path | A reply after a reconnect and a session/load: seconds. |
| The next message returns to the first pod | The pod evicts its entry without touching the sandbox, reconnects, and loads: seconds. |
| A deploy with a parked approval | The sandbox is kept. The answer reconnects to it on any pod and loads the session. |
| The first turn after a restart | The new process adopts the stopped sandbox; no fresh create. |
| A turn longer than 15 minutes | Keeps its sandbox, because the runner refreshes Daytona activity during the turn. |
| An idle session | Its sandbox stops after Daytona's interval, 2 or 3 minutes, instead of 120 seconds. |
| Kill | Finds the sandboxes by label and deletes their Secrets too. |
| A pod crash | Its sandboxes are adoptable by the next turn on any pod. |

Rows not listed match stage 1.

### At one replica (compose, Railway, self-hosted Helm)

Stage 1 changes nothing a user sees, except that a crashed runner's replacement no longer waits
for an owner key. Stop goes to the same single URL. Stage 2 removes the fresh sandbox create
after every restart.

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
| Follow-up on the other pod | Fresh sandbox, tens of seconds, half of follow-ups at 2 pods | Reconnect and load, seconds | Near zero while pods are stable; fresh sandbox when they change |
| Stop | Direct to the turn's pod, immediate | Same | Direct, immediate; wrong pod when the set changes |
| Code | About +200 lines; owner key removed | About +250 lines; park-to-stopped and delete-on-reconnect removed | About +200 lines, on top of the minimal design |
| New dependencies | Pod IP reachable from the api | Daytona labels, SDK calls reset autostop, daemon behaviour | Headless Service, two resolvers |
| Spikes | Measure the miss cost | Two | None |
| Risk area | The admission script, `request_cancel` | Secrets wrapper, sandbox lifecycle | Resolvers that disagree |

## Recommendation and staging

**Stage 1: correctness.** Ship the five common changes with the minimal rule. Two pods are safe.
Stop is direct and exact. Kill reaches every recorded sandbox. Deploys stop killing running
turns. Misses are expensive; measure them on the GKE stage.

**Stage 2: interchangeable pods.** Ship design B after its two spikes. It is the design the issue
asked for, it removes code, and it fixes the restart cost that every session already pays.
Commit to it now, and run the spikes in parallel with stage 1.

Hash routing is not recommended. It still needs the five common changes, adds a resolver in two
code bases, and hides the miss cost instead of removing it.

## Verification plan

### Spikes and measurements first

1. The daemon with two ACP servers (see "Two spikes that gate design B").
2. Daytona semantics: autostop on SDK `get` and on preview traffic, label limits, list latency,
   and whether the Secret list returns placeholders and hosts.
3. The miss cost of stage 1 on the GKE stage: time to first reply on a warm hit and on a fresh
   create.

### Unit tests

Runner tests use vitest under `services/runner/tests/`. Api tests use pytest under
`api/oss/tests/pytest/unit/sessions/`.

- The binding refuses a second replica on the first beat.
- Stop posts to the recorded address, falls into `not_held` when the address is unreachable, and
  a parked Stop goes to the parking pod.
- The warm cache check: own turn gives a warm hit; another pod's turn gives an eviction and the
  cold path; a failed read gives a warm hit.
- A resume 409 is silent; a fresh 409 fails the turn and deletes nothing.
- The minimal rule: the wrapper never deletes an unknown sandbox. Design B: the wrapper rebuilds
  the entry from labels and derived names.
- The incomplete flag written on one pod is read on another.
- Kill deletes every recorded id, not-found is success, and the in-process id is recorded at
  allocation.
- Shutdown: the drain flag and the wait. In design B, a settled cancel keeps the sandbox and an
  unsettled one deletes it. In the minimal design, everything is deleted.
- The chart renders `Recreate` for the local provider and fails for the local provider with
  `replicas > 1`.
- "Daytona does all the stopping": an eviction makes no stop call, and the in-turn refresh calls
  the SDK on schedule.

### Two-process test

With a fake api and a fake daemon, run two runner processes:

1. Park a session on A.
2. Continue it on B.
3. Send the next message back to A. A must evict and take the cold path.
4. Press Stop while B runs. The Stop must reach B directly.
5. Park an approval on A and press Stop. The Stop must reach A directly.
6. Send Kill. Every recorded sandbox must be deleted.

### Release gate

The `agent-release-gate` skill names a two-replica journey as a follow-up
(`.agents/skills/agent-release-gate/resources/qa_product.py:1592`). Add it, plus two cells:

- a duplicate `/run` with the same turn id on two pods, where the second is refused;
- the #7287 check: an answered approval row survives the turn-start sweep on a pod that holds
  nothing.

### Live check on the GKE stage

With `replicas: 2`:

1. A rolling deploy during a turn: the turn finishes.
2. A node drain during a parked approval, then the answer.
3. The miss cost in stage 1 and in stage 2.
4. Stop latency.
5. Daytona autostop on a long turn.

## Implementation order

Each step says what reverts it. Not every step is independent; the dependencies are named.

1. **Spikes and measurements.** Run the two spikes for design B and measure the stage 1 miss cost
   on the GKE stage. File the autostop issue. Nothing to revert.
2. **"Verify the warm cache before use" and the minimal rule.** Revert: a plain revert.
3. **"Bind the turn to its pod" and "Stop goes to the turn's pod", together.** Stop routes by the
   binding, so they ship as one pull request. A turn admitted before the deploy has no binding,
   and its Stop goes to the Service URL as today. Revert: as a unit; the owner key and the
   Service URL delivery return.
4. **"Kill every recorded sandbox" and "Drain, then cancel, then tear down".** Revert: a plain
   revert. The id-shape migration stays, because the code before this step already reads the
   prefixed form.
5. **Chart: `RollingUpdate` for remote providers, `replicas: 2` on GKE, the pod IP and pod name.**
   This step needs steps 2 to 4 in production. The device-login decision must be settled first.
   Revert: set `replicas: 1` and `Recreate` in the values.
6. **Design B: "The sandbox describes itself", then "Daytona does all the stopping", as two pull
   requests, after the spikes.** Revert: each pull request. "Daytona does all the stopping" needs
   "The sandbox describes itself", so revert it first.

## Decisions for Mahmoud

### Decision 1: how Stop reaches the turn's pod

**Today.** Stop goes to the Service URL. At one pod it always reaches the right pod. At two pods
half of all Stops reach the wrong pod and settle `lost`.

**Option 1: route by the turn's recorded pod address.** The binding names the pod at admission,
and the api posts to it. Stop stays direct and immediate, and its meaning does not change. Side
effects: the api must reach pod IPs, and a NetworkPolicy that blocks that traffic breaks Stop.

**Option 2: fan-out to every pod.** Stop stays direct and immediate. The api gains pod discovery
through a headless Service and partial-failure handling, and every Stop costs one request per
pod.

Heartbeat delivery is not an option; it is rejected under "Alternatives considered".

**Recommendation: option 1.** It reaches the right pod with one request, and the binding it
needs also fixes the double admission of one turn.

### Decision 2: commit to design B as stage 2

**Today.** Every restart costs each session a fresh sandbox, and a second pod would do the same
on every move.

**Option 1: commit to design B now.** Run its spikes in parallel with stage 1, then ship it as
stage 2. Pods become interchangeable, the restart cost goes, and code is removed. Side effects:
security-adjacent changes to the Secrets wrapper, a migration window, and a dependency on
Daytona's autostop and on the upstream daemon.

**Option 2: stop at stage 1 and measure.** No new dependency. Half of follow-ups at two pods pay
a fresh create, and every deploy keeps its restart cost. Decide on B after the measurement.

**Option 3: add a routing hint instead of B.** Follow-ups mostly reach the same pod while pods are
stable. It adds a resolver in two code bases, and it does nothing for the restart cost.

**Recommendation: option 1.** The spikes are cheap, and they run while stage 1 is built. Design B
is also the only option that removes the restart cost that every session already pays.

### Decision 3: shutdown order

**Today.** At SIGTERM the runner cancels every running turn within about 5 seconds and deletes the
sandboxes of running turns and parked approvals.

**Option 1: drain, then cancel with a settled wait, then tear down.** The pod refuses new turns
and lets running turns finish, up to the grace period. It cancels the rest and waits for each
cancel to settle. Stage 1 then deletes idle and parked sandboxes; stage 2 leaves them for
Daytona to stop. Side effects: a rolling deploy takes up to about ten minutes at two pods, and a
late request can get a 503.

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
