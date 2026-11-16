<!-- review-loop: design=21e041165ed5 lenses=simplify,naming -->

**Review loop result** for the `drive-sharing` design at repo commit `8d6f0dff68`, 3 rounds.

| Lens | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| Simplify (Codex) | Medium | Medium | High, fixed after the round |
| Naming (Codex in rounds 1 and 2, Opus in rounds 1 and 3) | Medium | Medium | Medium, fixed after the round |

**Decided in the loop:** the session drive is a boolean `has_session_drive` beside `drives` (Decision 3). A boolean cannot express the invalid combinations that a `{ "kind": "session" }` entry allows (a slug, read access, two entries). It has the same owner and lifecycle as `drives`, and it answers a different question ("does the working folder persist") than the list ("which drives does this agent attach"). The first name, `session_drive`, read as a drive object and was changed.

**Fixed:**
- A drive entry uses `kind`, not `scope`, because the naming conventions forbid copying `scope` into a new reference.
- The API and the runner use "mount" names for the new kind, beside the agent drive's names: `POST /mounts/projects/sign`, `fetch_project_mount`, `project-mount.ts`, `kind=project_mount`.
- One SDK validator, `validate_agent_drives`, owns the entry rules; the parse and the save check both call it. The save errors use the agent-facing envelope.
- A slug may appear once per list.
- The migration is idempotent, with a no-op downgrade and no side table.
- `inprocess` keeps today's rule that every mounted folder must mount before a file command runs. `has_session_drive: false` on `inprocess` is refused (`session_drive_required`).
- The runner resolves the drives of a run once, and every consumer reads that list.
- `access` applies only to project entries, so no rollout pair of versions can mount a read drive writable. The rollout order is the API, then the runner, then the agent service.
- Visibility between agents is promised after the upload and a cache refresh, not "by the next turn".
- Wording, the names table, type names (`AgentDrive`, `RunDrive`), and a stale sentence.
- A separate citation check fixed 4 wrong claims and 4 shifted line numbers.

**Left on purpose:** none. The round 3 findings were fixed in the spec after the last round and were not reviewed again, because the loop stops after three rounds. The code review loops on the pull requests review the result.
