# Status

**State:** design rewritten 2026-10-05 after an independent review. It awaits a second review
and Mahmoud's four decisions. No code has changed.

## Decisions for Mahmoud

Each decision has its context, options, side effects, and recommendation in
[plan.md, "Decisions for Mahmoud"](plan.md#decisions-for-mahmoud).

- [ ] Decision 1: route Stop by the turn's recorded pod address (recommended), or fan out to
      every pod. Heartbeat delivery is rejected.
- [ ] Decision 2: commit to design B as stage 2 after its two spikes (recommended), or stop at
      stage 1 and measure, or add a routing hint instead.
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

## Disagreements between the brief and research.md or the code

The design follows research.md and the code on each point below. plan.md states the result.

1. **Where the turn binding lives.** The brief put `replica_id` and `replica_address` inside the
   `started:<turn>` key. That key holds epoch milliseconds as a plain integer, and two readers
   parse it as a number (`locks.py:315-345`, `contract.py:277-283`). The binding is a sibling
   write-once key, `bound:<project>:session:<session>:turn:<turn>`.
2. **Where the records-incomplete flag lives.** The brief named `session_streams.flags`. That
   field is a typed mirror of three Redis booleans that the api rebuilds on every beat and read
   (`streams/service.py:849-853, 977-994`), so a new value would be overwritten. The flag lives
   on `session_sequence_cursors` and returns on the records query.
3. **How Secret names are derived.** The brief derived them from the sandbox id. The wrapper
   allocates every Secret before the sandbox exists (`daytona-secrets.ts:257-260`). The names use
   one allocation id per create, stored as the label `agenta.secret_allocation`.
4. **The Secret lookup by name.** The SDK's name filter matches parts of names, so the adopting
   pod filters the results on the exact name.
5. **The session label.** The brief proposed `agenta.session = <project>:<session>`. The
   in-process command sandbox already uses `agenta.project` and `agenta.conversation`. The
   Daytona path reuses those two keys. Labels are also excluded from the create fingerprint.
6. **The stored sandbox id shape.** The brief stored the raw id for both providers. The reconnect
   requires the `daytona/<raw>` form, which most rows already hold. Both providers store that
   form, and a migration prefixes the in-process rows.
7. **The SDK `get` and autostop.** The brief said the SDK documentation counts a `get` as an event.
   The documentation says "interactions with the Sandbox through the sdk"; the runner's own
   comment says the `get` is "believed" to count (research.md section 12.6). The second spike
   verifies it.
8. **Scenario 1 on the Daytona path.** The brief said pod A can still answer from a stale
   history. With the Secrets wrapper on (the default), pod B deletes pod A's sandbox, so pod A's
   next warm hit fails with a sandbox-gone error. The silent stale reply happens on the
   in-process path, and on the Daytona path with the wrapper off.
9. **Shutdown disposition.** The brief kept "settled cancel stops" in both designs and had design
   B stop idle and parked sandboxes at shutdown. In the minimal design no process can adopt a
   stopped sandbox, so it deletes every sandbox at shutdown. In design B a stop at shutdown can
   hit a sandbox that another pod has adopted, which is the case "Daytona does all the stopping"
   forbids. Design B leaves those sandboxes running for Daytona to stop.
10. **#6780.** The brief said its parking of an undeliverable Stop "still applies". #6780 is open,
    so it applies only after it merges.

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
