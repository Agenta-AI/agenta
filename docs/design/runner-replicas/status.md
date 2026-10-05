# Status

**State:** design revised 2026-10-05 for the warm requirement. It adds a sixth common change,
"Send follow-ups to the holder pod", and makes design B optional. It awaits Mahmoud's four
decisions. No code has changed.

## Decisions for Mahmoud

Each decision has its context, options, side effects, and recommendation in
[plan.md, "Decisions for Mahmoud"](plan.md#decisions-for-mahmoud).

- [ ] Decision 1: route Stop by the turn's recorded pod address (recommended), or fan out to
      every pod. Heartbeat delivery is rejected.
- [ ] Decision 2: do we still want design B, and when? Not now, and revisit if the measured
      restart cost hurts (recommended); or commit after the spikes; or never. An in-process-only
      product direction, raised the same day and not decided, would shrink design B to
      command-sandbox adoption.
- [ ] Decision 3: at shutdown, drain, then cancel with a settled wait, then tear down
      (recommended), or keep today's shutdown.
- [ ] Decision 4: hosted device login at two pods: move the attempt's state to the api if that
      is small, else disable it on multi-pod deployments with a clear error.

## Facts that changed the design

- The Secrets wrapper deletes any sandbox whose Secret allocation it does not hold, so a second
  pod, or a restarted one, destroys the first pod's sandbox and creates a fresh one (research.md
  section 13.1).
- Two pods that beat the same `turn_id` are both admitted, and the owner key passes between them
  on every beat (research.md section 13.6).
- Daytona's SDK documentation says preview traffic does not reset autostop, and the runner makes
  no SDK call during a turn (research.md section 13.9).
- The browser posts a plain follow-up straight to the services layer, and the api is not on that
  path. The services layer already reads `GET /sessions/streams/` from the api on every turn,
  for both senders (research.md section 14).
- Warm behaviour must stay as today 99 percent of the time, with a cold turn only when a pod dies,
  restarts, or is replaced (Mahmoud, 2026-10-05).

## Disagreements between the brief and research.md or the code

The design follows research.md and the code on each point below. plan.md states the result.

1. **Where the turn binding lives.** The brief put `replica_id` and `replica_address` inside the
   `started:<turn>` key. That key holds epoch milliseconds as a plain integer, and two readers
   parse it as a number (`locks.py:315-345`, `contract.py:277-283`). The binding is a sibling
   write-once key, `bound:<project>:session:<session>:turn:<turn>`.
2. **Who writes the binding.** The brief had the first-beat acquire script write it. A normal
   first beat never runs that script. On the browser path and on an api continuation, it takes
   `alive` over from the previous turn through the handover branch (research.md section 14.3). On
   the api's own send, `_start_turn` has already taken `alive`, and the beat goes through
   `refresh_alive` (`streams/service.py:731`, `:1203`). The heartbeat handler writes and checks
   the binding on every beat that names a turn.
3. **Where the records-incomplete flag lives.** The brief named `session_streams.flags`. That
   field is a typed mirror of three Redis booleans that the api rebuilds on every beat and read
   (`streams/service.py:849-853, 977-994`), so a new value would be overwritten. The flag lives
   on `session_sequence_cursors` and returns on the records query.
4. **How Secret names are found.** The brief derived them from the sandbox id. Three facts rule
   that out. The wrapper allocates every Secret before the sandbox exists
   (`daytona-secrets.ts:257-260`). Ordinals follow the request's iteration order
   (`daytona-secret-plan.ts:238`). A slot set rebuilt from the request makes the reconnect check
   circular. Design B writes an immutable slot
   manifest with the sandbox.
5. **The Secret lookup by name.** The SDK's name filter matches parts of names, so the adopting
   pod filters the results on the exact name.
6. **The session label.** The brief proposed `agenta.session = <project>:<session>`. The
   in-process command sandbox already uses `agenta.project` and `agenta.conversation`. The
   Daytona path reuses those two keys, in stage 1. Labels are excluded from the create
   fingerprint.
7. **Kill's inventory.** The brief had Kill read the sandbox ids from the turn rows. A project
   caller can write that column, and it misses replaced command sandboxes. Kill lists sandboxes by
   label instead, and the `/kill` body does not change.
8. **The SDK `get` and autostop.** The brief said the SDK documentation counts a `get` as an event.
   The documentation says "interactions with the Sandbox through the sdk"; the runner's own
   comment says the `get` is "believed" to count (research.md section 12.6). The second spike
   verifies it.
9. **Scenario 1 on the Daytona path.** The brief said pod A can still answer from a stale history.
   With the Secrets wrapper on (the default), pod B deletes pod A's sandbox, so pod A's next warm
   hit fails with a sandbox-gone error. The silent stale reply happens on the in-process path, and
   on the Daytona path with the wrapper off.
10. **Shutdown disposition.** The brief kept "settled cancel stops" in both designs. The minimal
    design deletes every sandbox at shutdown, because no other process can reconnect to it.
    Design B leaves sandboxes running for Daytona to stop, because a stop could hit a sandbox
    that another pod has adopted.
11. **#6780.** The brief said its parking of an undeliverable Stop "still applies". #6780 is open,
    so it applies only after it merges.
12. **Two citations in the second review's notes.** The runner function is
    `claimSessionOwnership` (`alive.ts:235`). `_deliver` is defined at `commands/service.py:1216`;
    line 1454 is a call to it from the sweep.

## Log

- 2026-10-05: research.md (code map) and github-context.md (issue and pull request history)
  written.
- 2026-10-05: first design drafted. It delivered Stop through the heartbeat and assumed that a
  second pod reconnects to a running sandbox in seconds.
- 2026-10-05: an independent review and research.md section 13 showed that a second pod deletes
  the first pod's sandbox today, and that two pods can run one turn.
- 2026-10-05: Mahmoud ruled that Stop stays direct and immediate, that every change states its
  costs, and that design B is designed in full.
- 2026-10-05: README.md, context.md, plan.md, and status.md rewritten from the third design brief
  and research.md.
- 2026-10-05: a second independent review found gaps. The designer decided 22 points, now in
  plan.md:
  - The binding is written in the heartbeat handler on every beat, and a refused final beat
    changes nothing.
  - The address is trusted only from a beat with the runner token.
  - The local-provider affinity probe is deleted in full. The heartbeat response keeps
    `replica_id` for one release.
  - Stop resolves the address in `_deliver`, keeps `unreachable` distinct from `not_held`, and
    checks the target turn on a parked Stop.
  - The warm cache check compares `turn_index` and fails closed. A fresh 409 makes no cold retry.
  - Kill moved to a label inventory, with the two inventory labels in stage 1.
  - The drain covers every admitted execution and keeps `/cancel` and `/kill` open.
  - The minimal rule no longer depends on the Secrets wrapper.
  - Design B ships its no-stop rule first and adoption second, adds a slot manifest and a
    credential write on adoption, and takes stop-before-adopt as its baseline.
  - Decision 2 now recommends deciding on design B at the end of stage 1.
  - Four checks were added to the verification plan.
- 2026-10-05: Mahmoud added the warm requirement: warm behaviour as today 99 percent of the time,
  a cold turn only when a pod dies or restarts, and compose and one-pod Helm unchanged. The
  minimal design as written sent half of all follow-ups cold at two pods, so it failed the
  requirement. research.md section 14 mapped the send path. The design now:
  - adds "Send follow-ups to the holder pod": the streams read returns the binding's address to
    the services layer, and the SDK transport posts there, with one retry at the Service URL
    before the first byte;
  - returns `runner_address` only to a caller with the runner token, because browsers also call
    the streams read and the pod IP is internal to the cluster;
  - corrects the facts about the first beat: on the browser path the runner mints the turn id, and
    the first beat takes `alive` over from the previous turn;
  - makes design B optional, moves it after the alternatives, and rewrites decision 2;
  - drops hash routing's one advantage from the trade-off table, and drops the routing hint from
    the follow-ups.
- 2026-10-05: the holder route also covers approval continuations and queued inputs, because the
  api sends them through the same services handler (research.md section 14.1). An approval answer
  now resumes warm on the parking pod while that pod lives.
