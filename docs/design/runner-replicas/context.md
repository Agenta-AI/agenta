# Context: why the runner must run as several replicas

Terms in this file are defined in the [README glossary](README.md#glossary).

## The problem

On GKE, the platform moves pods between nodes. It does this during node drains, autoscaler
scale-downs, and node upgrades. The runner runs as one replica, so every move takes the only
runner away. Until the new pod is ready, no agent turn can start on the deployment, for any
user.

The measurements in issue #7322:

- A runner pod delete took 48 seconds to reach ready on a node with free room.
- During a node drain, the same step took one to three minutes.
- On 2026-10-03, a stage was unreachable for about three minutes when GKE Autopilot moved
  single-replica pods (#7320).

The other workloads already run two replicas. #7320 gave them a PodDisruptionBudget and
topology spread. A measured drain with two replicas gave zero failed requests over 230 seconds.
The runner is the one workload that cannot follow yet.

One runner process also serves every session. In #7049 a busy loop after one Stop froze the
whole process for fifteen hours. A second replica limits such a fault to the sessions on one
pod.

## What a user sees today with one pod

These facts hold at one replica, before any change.

**A message during a pod move fails.** The services layer posts the turn to the Service URL,
and no pod is ready to take it. The chart uses `strategy: Recreate` for the runner, so every
deploy also has a window with no runner pod.

**A turn in flight on the leaving pod is lost.** At SIGTERM the runner deletes the sandbox of
every running turn within about 5 seconds. The orphan sweep settles the turn as `lost` 90
seconds after its last heartbeat (research.md section 12.5). Records already sent to the api
survive.

**A parked approval loses its sandbox at shutdown.** At SIGTERM the runner deletes the sandbox
of every `awaiting_approval` entry (research.md section 12.5). The user's answer still works.
The next pod reads the answer from `session_interactions`, the model issues the call again, and
the call runs without a second question (research.md section 5.1).

**Every restart costs each session one fresh sandbox on its next turn.** The Secrets wrapper
keeps each sandbox's Secret allocation in the memory of the process that created it. A new
process has no allocation for any sandbox. When it reconnects to a session's sandbox, the
wrapper deletes that sandbox and reports a failure. The reconnect steps then create a fresh one
(research.md section 13.1). The wrapper is on by default, and it applies even to a
session with no Secret. So park-to-stopped does not survive a restart: the stopped sandbox is
deleted on the next turn. The conversation survives, because the harness transcripts live on
the mounted object store and session/load reads them. The cost is a full sandbox create on the
first turn after every deploy.

**The same turn on two pods would be admitted twice.** If two pods beat the same `turn_id`, the
api admits both. The owner key then passes between them on every beat, and neither turn is
interrupted (research.md section 13.6). A plain `/run` retry with the same turn id can cause
this. The second pod's final `is_running: false` beat can also release `running` for the turn
that the first pod still runs. Today one pod hides the fault, because the second request reaches
the same process.

**A turn longer than 15 minutes may lose its sandbox.** Daytona's SDK documentation says that
autostop counts SDK calls and state changes, and that preview traffic does not count. During a
turn the runner talks to the sandbox only through the preview proxy, and it makes no SDK call
(research.md section 13.9). By the documentation, Daytona stops the sandbox 15 minutes into a
long turn. Nobody has measured this on a live sandbox yet.

## What breaks with two pods

With two pods behind one Service, each request reaches either pod. The four scenarios below
follow one user, Ana, on the Daytona path unless they say otherwise. Pod A and pod B are the two
runner pods.

### Scenario 1: a follow-up message reaches the other pod

**Situation.** Ana sends message 1. The Service sends it to pod A. After the turn, pod A parks
the environment `idle` with a 120-second timer. The sandbox keeps running. Forty seconds later
Ana sends message 2, and the Service sends it to pod B.

**What happens.**

1. Pod B has no pool entry for the session, so it takes the cold path.
2. Pod B reads the latest session_turns row and finds pod A's sandbox id.
3. Pod B's Secrets wrapper has no allocation for that sandbox. It deletes pod A's sandbox and
   reports a failure (research.md section 13.1).
4. The reconnect steps create a fresh sandbox. Pod B calls session/load, and the harness reads
   its transcript from the mounted object store.
5. Ana gets a correct reply, after a full sandbox create.

Now suppose Ana sends message 3 within pod A's 120-second window, and the Service picks pod A.
Pod A still holds its idle entry, and nothing in the warm-hit decision compares that entry with
the session_turns rows (research.md section 12.7).

- **On the Daytona path,** pod A's sandbox no longer exists. Pod A takes the warm hit, its
  sandbox-gone check fires, and the turn fails with an error.
- **On the in-process path,** pod B does not touch pod A's sandbox. Pod A takes the warm hit on
  its live Pi session, which never saw message 2. Pod A writes its turn row, the api refuses it
  with a 409 for the duplicate `turn_index`, and the runner ignores the refusal (research.md
  section 12.3). Ana gets a reply that ignores message 2, with no error. Pod A then saves its
  Pi transcript, so the durable transcript holds turns 1 and 3 and loses turn 2.

The same stale reply happens on the Daytona path when the Secrets wrapper is turned off. Pod B
then reconnects to pod A's sandbox instead of deleting it.

**Who is harmed, and when.** Half of Ana's follow-ups at two pods wait for a full sandbox
create. A follow-up that returns to the first pod inside its timer either fails or answers from
a history that lacks a turn. The in-process case also damages the stored transcript.

**Plain cause.** A sandbox belongs to the process that created it, and nothing tells pod A that
another pod has moved the session forward.

**Status.** Confirmed in code (research.md sections 12.3, 12.7, 13.1). No test covers two pods.
The common change "Verify the warm cache before use" and both designs address it.

### Scenario 2: Ana answers a parked approval on the other pod

**Situation.** Ana's agent asks to run `git push`. Pod A parks the turn as `awaiting_approval`.
The harness prompt and its permission request stay open in pod A. On the Daytona path the
approval timer is 120 seconds. Ana approves after sixty seconds. The api records the answer and
creates a continuation, which the Service sends to pod B.

**What happens.**

1. Pod B cannot answer the open permission request, which lives on pod A's ACP connection.
2. Pod B takes the cold path. As in scenario 1, its Secrets wrapper deletes pod A's sandbox,
   with the parked prompt inside it, and creates a fresh one.
3. Pod B reads Ana's answer from `session_interactions` and seeds it as a decision. The model
   issues the call again, and it runs without a second question (research.md section 5.1).
4. Pod B's first heartbeat takes the owner key from pod A through the departed-owner path
   (research.md section 5.3).

The api names a further hazard in its own code (`streams/service.py:499-506`). With several
replicas, a second replica can take the owner key while the first holds a parked approval. The
heartbeat handover then marks the parked turn `superseded`, "killing the pending approval".

**Who is harmed, and when.** Ana's approved call runs, but only after a full sandbox create.
Files the agent wrote outside the mounted session folder are gone with pod A's sandbox. In the
handover case, Ana's approval card closes before she answers it.

**Plain cause.** The live prompt cannot leave pod A, and the Secrets wrapper and the owner key
both act on another pod's state.

**Status.** Confirmed in code. A related check is open: at turn start the runner cancels stale
pending interactions that this pod does not hold (#7287). On pod B that set is empty. Ana's
answered row must survive the step; it should, because its status is `responded`. A test must
prove it.

### Scenario 3: Ana's Stop reaches the other pod

**Situation.** Ana's long turn runs on pod B. She presses Stop.

**What happens.**

1. The api writes a `cancel` row in `session_commands` and posts `/cancel` to the Service URL.
   The Service picks pod A.
2. Pod A has no live execution and no parked entry for the session. It answers 404 "session not
   held here" (`services/runner/src/server.ts:1586-1591`).
3. The api sees that pod B's turn still beats. It settles the command `lost` and logs an error
   (research.md section 6.2).

**Who is harmed, and when.** Half of Ana's Stops at two pods do nothing. Her agent keeps
working, and it keeps spending tokens and sandbox time.

**Plain cause.** The api sends Stop to an address that picks a pod at random.

**Status.** Confirmed in code. Issue #6634 shows a worse form at one replica: after three failed
deliveries the api settles a turn `lost` while the runner still beats. Its fix, #6780, is open.

### Scenario 4: Ana's Kill reaches the other pod

**Situation.** Ana deletes the session while its sandbox is warm on pod B.

**What happens.**

1. The api ends the turns, clears the owner key, and posts `/kill` to the Service URL. The
   Service picks pod A.
2. Pod A removes the session from its own pools and its own list of sandboxes in use. It finds
   nothing and answers 200 (`server.ts:1483-1531`).
3. The api marks the session ended. It never reads `session_turns.sandbox_id` and never calls
   Daytona (research.md section 6.4).

**Who is harmed, and when.** The session is gone from Ana's screen, but its sandbox keeps
running on pod B until pod B's timer stops it. Daytona deletes it 30 minutes after that. The
sandbox costs money for that time and keeps the session's files.

**Plain cause.** Kill acts only on the receiving pod's memory.

**Status.** Confirmed in code. The same gap exists at one replica for a sandbox that no pool
entry holds. The turn rows cannot serve as a list of the session's sandboxes. On the in-process
path, the first turn's row never records its command sandbox id, and a replaced command sandbox
is never recorded (research.md section 13.7). Any caller with the project permission can also
write `sandbox_id` on a turn row (`router.py:1966-1980`). The in-process command sandbox carries
the labels `agenta.project` and `agenta.conversation`; a Daytona-path sandbox carries no labels.

## Goals

- The runner runs with two or more replicas on GKE. A pod move or a deploy does not stop new
  turns, because the other pod takes them.
- A deploy or a node drain does not kill running turns. The leaving pod lets them finish first.
- Stop acts at once on the pod that runs the turn, at any replica count.
- Kill deletes every labelled sandbox of the session, whichever pod receives it.
- No pod answers from a stale harness session, and no pod destroys or stops a sandbox that
  another pod uses.
- One replica (compose, Railway, self-hosted Helm) keeps working with no setup change.
- If design B ships as stage 2, a follow-up on another pod reuses the session's sandbox instead
  of creating one. A restart then no longer costs each session a fresh sandbox.

## Non-goals

- **The `local` sandbox provider.** It keeps session files on one host's disk (#5404, #6446,
  #6862), and GKE Autopilot cannot run it (#6690). The limit stays: one runner when the local
  provider is enabled.
- **Autoscaling the runner.** A HorizontalPodAutoscaler is a follow-up.
- **Durable reconciliation of every Daytona Secret.** Design B makes Secret names derivable,
  which lets a sweep find orphans by prefix. The sweep itself stays with #6438.

## Constraints from earlier work

These facts come from the history in [github-context.md](github-context.md). Each one limits the
design.

1. **Stop acts at once.** The session-control work (#6503) moved Stop from the heartbeat to a
   direct command to the runner, so that the runner acts on it immediately. The design keeps
   that guarantee at every replica count.
2. **There is no rollback switch.** #7095 and #7097 removed the durable Stop and approval flags.
   Each change must be safe on its own, and the implementation order states what reverts it.
3. **`is_current_turn: false` already has three meanings.** The runner cannot tell them apart
   and aborts on any of them (#5611, #6765). The design must not add a fourth.
4. **A shared replica id makes every pod claim every session** (#5404). The chart pins the id
   only at one replica today. Two external scripts match the local guard's error text (#6446).
5. **The orphan sweep allows one ending per execution.** It settles by heartbeat age (90 seconds)
   and enforces one terminal outcome by compare-and-set (#6501). A pod change must not produce a
   second ending.
6. **The record log is the conversation of record.** The playground sends only the last user
   message, and the runner rebuilds earlier turns from the record log (research.md section
   12.7). When the log has a hole, the turn fails instead of guessing (#5493).
7. **A warm sandbox needs a valid mount lease.** A pod reuses a sandbox only if its mount lease
   covers the run deadline plus 60 seconds (#6136). An adopting pod must pass the same check.
8. **The reconnect path has broken before** (#5538, #6765, #7049, #7099). The tests must cover a
   race between two pods, a dead pod, and an open ACP request.
9. **Daytona Secret ownership is process-local by design.** The Secrets wrapper deletes what it
   cannot prove (research.md section 13.1). Any change that lets a pod adopt a sandbox must give
   that pod a way to prove the sandbox's Secrets.
