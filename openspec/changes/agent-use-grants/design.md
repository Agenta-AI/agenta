# Design note: agent use grants (M8, deferred)

Status: NOT IMPLEMENTED. This note defines no table, router, DAO, UI or checklist. A later change must resolve the questions below before any of those exist.

## Goal

Project S (home) lets project M (grantee) use one agent of S. The run happens in S, so traces, files, usage and S's project credentials stay in S. A grant never makes an M member a member of S (CONTRACT.md section 2) and gives no other access to S.

## Why the existing milestones cannot be reused unchanged

A Marketing user is, on purpose, not a Sales member. The current contracts deny the grant path at each step:

- M3 session access needs the project capability (`VIEW_SESSIONS`, `RUN_SESSIONS`) in the session's project, and it locks a private session whose owner is not a project member. A grant session in S owned by an M member would be locked at once.
- M6 doors need current target-project access and a parent run in the human's own personal project (CONTRACT.md section 10). A grant run has neither.
- `AccessService.decide` (CONTRACT.md section 6) checks membership eligibility first. A grantee fails with `not_member` before any grant rule runs.
- The runtime needs more than "use the agent" in S: session writes, file reads and writes, credential release, and trace writes.
- Recording `origin_id = grant_id` on a turn does not define a durable link from a session to its grant. Later reads, especially after revocation, have no source of truth.

## Unresolved execution semantics

A later design must define these three things:

1. **Granted-execution context.** A narrow, server-derived context for a run in S that is authorized by a grant, not by membership. It must state how the membership step of `decide` is satisfied for this context only, and that no other request in S can claim it.
2. **Durable session-to-grant linkage.** A stored relationship between a session in S and the grant that created it. It must answer who can read and continue the session, and what happens to reads, turns and approval resumes after revocation, after the agent becomes private or moves, and after the starter loses access in M.
3. **Runtime operations versus user access.** An explicit list of the operations that the granted agent's run may perform in S (as M2 does for installations, CONTRACT.md section 4), kept separate from what the starting user may do in S, which stays nothing. Child agents stay refused unless the server can prove the relationship from the resolved revision.

## Constraints a later design must keep

- The grantee is a project, not a user. Both projects are team projects in one organization.
- M7 credential rules apply unchanged: a grant session is private to its starter, so `caller_account` may use the starter's personal credentials, and the shared-session rule applies if the session is ever shared.
- M9 trace privacy applies to grant sessions in S.
- Permission names are to be defined by that change. M3's `MANAGE_AGENT_OWNERSHIP` has a different purpose and is not reused.

## Open questions

1. Does the starter keep read access to their past grant sessions after revocation? Recommendation: yes, read-only, through the session-to-grant link.
2. Should a granted run ever call other S agents? Recommendation: no in the first version.
