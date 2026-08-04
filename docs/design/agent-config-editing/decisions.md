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

## Product calls confirmed by Mahmoud

(Empty. The seven open calls below move here once answered.)

## Open product calls (waiting on Mahmoud)

1. **Storage normalization (engine O2, O3).** Normalize configuration strings once on
   write: Unicode to NFC, line endings to LF. Exact matching then stays honest.
   Recommended: yes. Risk: stored bytes change on the next write of old fields.
2. **Unique-name enforcement and old configurations (engine O7).** A configuration that
   already holds a duplicate name would become uncommittable under a global check.
   Recommended: enforce per commit only for collections the commit touches, warn on the
   rest, and file a cleanup migration separately.
3. **Embedded skills stay unaddressable in v1 (engine O6).** An agent with an
   `@ag.embed` skill cannot edit it by name; it must use a whole-list `set`.
   Recommended: accept for v1, design a stable embed key later.
4. **Ungated `value_from` (runner Q1).** When the run's permission policy raises no
   approval gate, the folder content is committed without a human seeing it.
   Recommended: follow the run's policy (no forced gate); the policy owner opted out.
5. **Binary files in skill folders are dropped with a warning (runner Q3).** A skill
   with a PNG or a compiled helper loses that file in v1. The eventual fix is a blob
   `uri` file variant. Recommended: accept for v1, flag in the approval card.
6. **`value_from` reach (runner Q4).** Any path under the workspace root, or a
   designated subfolder only? Recommended: whole workspace; the approval manifest is
   the control.
7. **Pi tool removal means hidden (runner Q5).** The tool stays registered but the
   model cannot see or call it. Recommended: accept.
