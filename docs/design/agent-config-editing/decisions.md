# Decisions log

Each entry records a decision, who made it, and where it applies. The spikes' full
reasoning is in `spikes/engine-spike.md` (D1-D33, O1-O12) and `spikes/runner-spike.md`.

## Accepted from the engine spike (team lead, 4 August)

- All engine decisions D1-D33 stand, with three amendments below.
- **Amendment to D4 (auto-creation):** `set` creates missing OBJECT parents on the way to
  its last segment. It never creates a list entry. Reason: without this, setting a field
  inside an absent `extras` bag needs two operations, and the second is a `set` of an
  empty object. `merge` stays strict (D5 unchanged).
- **Amendment to D15 / answer to O1 (overlap counting):** count occurrences WITH overlap.
  Two overlapping matches give `text_not_unique`. This diverges from Pi and is safer for
  code and indented Markdown.
- **Answer to O4 (match_mode):** the `edit_text` operation carries `match_mode` from day
  one. Only `exact` is allowed. Adding a mode later is then not a breaking change.
- **Answer to O8 (warnings):** the commit response carries a `warnings` list. The engine
  returns warnings to the wrapper; the wrapper owns the response.
- **Answer to O9 (no-effect commits):** the engine reports whether the result equals the
  base. The commit wrapper then refuses to create a revision and answers with a
  `no_change` warning and the current head id. This also serves the session-reuse goal:
  no new revision, no eviction.
- **Answer to O10:** the legacy/strict asymmetry is accepted for the transition.
- **Answer to O11:** `out_of_scope` stays 422 with its reason code.
- **Answer to O12:** `service.py` imports `deep_merge` from the engine. One home.

## Accepted from the runner spike (team lead, 4 August)

- `value_from` resolution runs at the permission gate, frozen per tool-call id, with
  inline resolution at execution as the fallback for ungated calls.
- The workspace reader is its own abstraction with two implementations: local `node:fs`,
  and a Daytona one-shot exec manifest (`find` + `realpath`), because the Daytona FS API
  has no mode bits and no symlink information.
- The tools-discovery verdicts replace the lifecycle document's assumptions:
  - Pi: apply-live is reachable. Ship tool specs as a file instead of an env var, add an
    extension hook that re-reads it and calls Pi's live `registerTool` / `setActiveTools`.
    A removed tool is hidden, not deregistered; Pi has no deregister API.
  - Claude: apply-live is reachable. Our shims must advertise the MCP
    `tools.listChanged` capability and emit the notification; Claude's side is built.
    The local HTTP shim has no push channel and stays reopen-session in v1.
  - Codex: reopen-session. The ACP adapter bakes MCP config at session creation.
  - MCP server-list changes: reopen-session on every harness. No live API exists.
  - Observation timing is planned as next-turn everywhere until measured.
  - Prerequisite for all of it: remove `customTools` from the eviction fingerprint in
    the same change that adds a live path.
- The characterization tests are the contract for the lifecycle refactor: slices 5-7
  must edit them deliberately.

## Contract phase (team lead, 4 August, after the NO-GO gate)

- The six contracts in `contracts/` are the implementation source of truth. They
  supersede the matching sections of the two research documents where they differ.
- Fail-closed defaults adopted from the gate review: every `value_from` import comes
  from the `imports/` root; unsupported files reject the whole import unless the caller
  opts into omission; executable permission is caller-declared and default-deny, never
  derived from file mode bits; frozen approval bytes never ride tool arguments; a cold
  resume refuses the old approval and raises a new gate.
- Arbitration (superseded in detail by the four-layer split below): the `value_from`
  folder source carries optional import-policy fields that the runner consumes and
  strips; the engine never sees them. The current fields are `on_unsupported`,
  `on_executable`, and `persist_executable_capability`. change-set.md §5.1 and
  workspace-import.md §5.2 are authoritative.
- Inline resolution happens only on an explicit allow verdict from the permission
  plan; a missing authorization for a gated call fails closed.

## Product calls confirmed by Mahmoud

(Empty. The open calls below move here once answered.)

## Arbitrations after gate 2 (team lead, 4 August)

- **Text-file import into a text field.** `value_from` on `set` is allowed under three
  required conditions: single file source, string-typed target from the four known
  long-text fields, unified diff at approval. Folder-into-`set` stays disallowed. This
  restores the founding use case (an oversized instruction file, issue #5554).
  change-set.md §5.1.1-§5.1.2; workspace-import.md §8.
- **Executable permission, four layers, one owner each.** The file's `executable` bit
  is data. `on_executable` on the folder source is the ephemeral import grant, default
  reject. `persist_executable_capability` writes the stored skill capability, default
  false, and requires the import grant. The materializer's exec policy stays the
  platform's. The conservative always-false alternative was rejected: an inert
  imported skill with no visible reason is a worse failure than an explicit two-line
  approval card. workspace-import.md §5.2; change-set.md §5.1.3.
- **Acknowledgement channel realism.** No fully trusted channel exists from inside a
  Daytona sandbox. The design makes a forged acknowledgement harmless instead of
  pretending to secure the channel: worst case is a stale model-visible catalog, never
  a privilege escalation. adapter-matrix.md §4.3.

## Settled by the contracts (no longer open)

- Binary and unsupported files reject the whole import by default; `on_unsupported:
  "omit"` is the explicit opt-in. (Was open call 5.)
- Imports come from the designated `imports/` root, not the whole workspace. (Was open
  call 6.)
- Cold resume refuses the old approval and asks again; frozen bytes are not persisted
  durably. (Was open call 9.)
- Pi tool removal hides the tool AND drops the runner execution binding; hidden-only
  never ships. (Was open call 7.)
- Embedded skills stay unaddressable in v1; support can be added later without a
  breaking change. (Was open call 3.)

## Open product calls (waiting on Mahmoud)

Six distinct decisions. The first five block their implementation slices.

1. **Storage normalization** (blocks S1a/S1b). Normalize configuration strings once on
   write (Unicode NFC, line endings LF), or preserve exact bytes? The second gate
   review recommends exact bytes in v1. My earlier recommendation was normalize.
   Mahmoud decides; the engine's matching and the migration story follow.
2. **Unique-name enforcement** (blocks S1b validation). The contract proposes: a commit
   must not introduce a new duplicate, a touched collection must end clean, untouched
   legacy duplicates only warn. Confirm or change.
3. **Import gating rule** (blocks S3b). Always force an approval gate on `value_from`,
   or gate by default with inline resolution only on an explicit allow verdict from the
   permission plan? The contracts implement the second. (Merges former calls 4 and 8.)
4. **May the agent change its own `harness.kind`?** (blocks S2's scope section.)
   Recommended: no; human commit only.
5. **May the agent write `parameters` outside the `agent` subtree?** (blocks S2's
   scope section.) Recommended: no.
6. **Store the authored operations for audit** (blocks S1b persistence design).
   Recommended: yes, on the revision commit record.
