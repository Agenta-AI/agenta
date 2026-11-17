<!-- review-loop: design=daaf542ca0e4 lenses=simplify,naming -->

**Review loop result** for the unified drive design (repo commit `81804cc34d`), 3 rounds. A security lens ran next to the two design lenses in each round.

| Lens | Final rating |
| --- | --- |
| Simplify | High in round 3, both findings fixed after the round |
| Naming | Medium in round 3, all findings fixed after the round |
| Security | Medium in round 3, all findings fixed after the round |

**Fixed:**
- A run names its agent through a claim in the run credential, written by the API when it prepares the invoke. The design no longer depends on a stored turn record or on the revision.
- One home rule, `check_home_drive`, serves the save, the sign with `is_home=true`, the legacy sign route and the change to private.
- Lookup and signing exclude session drives by `session_id`. Existing agent drives with a reserved slug stay usable in release 1.
- The fill on read obeys the drive rules, and the visibility change reads through the same fill.
- Sharing an agent shares only the private drives of the person who acts. A personal agent's home must be private to its owner.
- Drives use the one access entry, `SharingService.evaluate`.
- The legacy sign route signs only for agents with no stored `drives` key.

**Left on purpose:**
- Old API pods decide the file routes by agent until they drain. The window is short and stated in the rollout table.
- The assumption that child runs, triggers and evaluations all mint their credential in the same place is not verified. Task 1.2a checks it.
- No fourth round ran. The round 3 fixes were checked by validation only.

**Later changes** (not reviewed as a design): during the code review of PR 8315, the design took the code's decisions on the read shape of an agent without a drive row, the two run credential mints of `run_agent_id`, the reserved slug lookup by agent id, the disclosure field names, a known limit for an interrupted first commit, and the tasks for after release 2.
