# Review loop

Each round ran fresh reviewers that got the files, not the author's conclusions. Lenses:
grounding (every fact against the code), simplify, naming and layering, security.

## Round 1

| Lens | Rating | Blockers |
|---|---|---|
| Grounding | 4 blockers, 6 major, 4 minor | settle and apply in one transaction across DAOs is not possible (G49); the first pass emails about the last 24 hours; an older success resolved a newer failure; the records retry bound was wrong (G20) |
| Simplify | Medium | |
| Naming and layering | Medium | |
| Security | 0 high, 5 medium | |

Fixed:

- No transaction crosses DAOs. The rules run before the guarded settle write, and each step is idempotent (D15).
- A failure opens a notification only if it ended less than 1 hour before the pass (D17, rule A0).
- A success resolves only a notification whose failure started earlier (rule A3).
- G20 corrected: a transient records failure is retried with no end. The 5-minute wait is a heuristic (known limit 5).
- The settle candidates use a partial index that leaves out settled rows, and a pass reads at most 10,000 rows.
- The screen reads `data.outcome` only on `202` trigger deliveries, because a merged `data` can keep an old outcome (G8).
- `access_denied` from the dispatcher became `paused_access_denied`, apart from the runner's code (G25).
- Real client timeouts on SMTP and SendGrid replace `asyncio.wait_for` (G41, G42).
- `send_rendered_email` raises in both no-op cases (G39).
- Recipients need `view_triggers` (G32, G33), are checked again at send time, and are read through `MembershipsService` (users are hard-deleted, G36).
- The email does not name the agent (D10, G37).
- Automation names are normalized (control characters, length).
- Logs carry ids and the exception type only.
- The notification keeps a snapshot of what the email needs. `core/notifications` reads no trigger table (D16).
- The switch and the provider check moved to the send pass only.
- Resolve on edit, start, refresh and delete only. No flag for `refresh_schedules` (G27).
- Names: `state`, `attempt_count`, key `(project_id, id)`, `uq_` index names, `waiting` instead of `paused`, `reason_code` everywhere, `resolve` and `settle`, `*_pass.py`, capability `automation-failure-notifications`, `trigger_delivery_id`, a naming table.
- Line numbers and wording of G2, G7, G8, G12, and the proposal.

Not taken:

- One loop for both passes (simplify). A send takes up to 30 s, so 100 sends would hold up settling.
- Dropping `notifications.state` for `resolved_at IS NULL` (simplify). The naming lens asked for `state` like `session_commands.state`. One DAO method writes both.
- Cooldowns, per-recipient caps and per-project fairness (security). They change the agreed rule "fail, fix, fail sends two". The send pass caps all email at 100 per minute. Flapping is known limit 9.
- A retention sweep (security). Known limit 10.
