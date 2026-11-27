<!-- review-loop: design=6ad0a37915ac lenses=simplify,naming -->

**Review loop result** for this design at repo commit `8d6f0dff68`, 3 rounds. After the loop, only quotes and background text were removed for the public repo; no decision changed.

| Lens | Round 1 | Round 2 | Round 3 | Final |
| --- | --- | --- | --- | --- |
| Simplify (Codex) | High | High | Low | Low |
| Naming (Codex in rounds 1 and 2, Opus in rounds 1 and 3) | Medium, Medium | Low | Medium | Fixed after round 3, not reviewed again |

**Fixed:**
- The migration could not run again after a failed concurrent index build, because the column was already committed. It now adds the column with `ADD COLUMN IF NOT EXISTS` and drops an invalid index before it builds again.
- The new field `root_turn_id` suggested a tree of turns. It is now `session_turn_id` / `sessionTurnId`, because its value is the `turn_id` of the session turn row. D4 records that the shipped `turn_id` / `turnId` fields hold the execution id.
- The resume no longer reads the session's latest turn row. A later turn row can exist while an approval waits. The service that admits the approval walks the execution chain instead.
- The walk stops at the turn's starting execution (the nearest execution that no approval created). A plain walk to the root crossed into an earlier turn, because a queued new message also links to the execution before it.
- Round 3: every file now uses the same definition of the turn's starting execution, and the D4 naming note lists the command fields that hold execution ids.

**Left on purpose:**
- The shipped execution-id fields named `turn_id` / `turnId` are not renamed. A rename of shipped contracts is outside this change.
- Known limit: a second approval inside a recovery attempt (after a lost delivery) gets the replacement execution's id. It is rare, and a lookup for it would add machinery for a rare case.
- The naming fix after round 3 was not reviewed again, because the loop stops after three rounds.
