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

- **Decision 1 (5 August): Option A, exact bytes.** Stored configuration text is
  never normalized. The prose-side friendliness lives in matching (exact first,
  then a normalized retry for prose fields only, per the match-tolerance decision
  above), never in storage. This unblocks slices S1a and S1b.
- **Decision 2 (5 August): confirmed.** A commit may not create a new duplicate
  name; a collection the commit touches must end clean; untouched legacy
  duplicates warn. The engine already implements the three tiers.
- **Decision 4 (5 August): no.** The agent may not change its own harness.kind.
  Human commit only in v1. The write-scope allow-list stays fail-closed.
- **Decision 5 (5 August): no.** Agent commits stay scoped to parameters.agent.
- **Decision 6 (5 August, amended same day): audit through the EXISTING fields,
  no new column, no migration.** Mahmoud rejected the JSONB column. The
  server-derived commit message (already decided) IS the audit: it is built from
  the operations, so it is always accurate ("edited instructions, 2 edits; added
  skill pdf-tools from .agenta-imports/pdf-tools"). Where more detail helps, the
  commit record's existing description field carries it, still text, still no
  schema change. A machine-readable operations store is dropped from v1 and noted
  in open-issues as possible future work.
- **The dao lock extension (2a) is accepted with three conditions (Mahmoud,
  5 August):** (1) it ships as its OWN minimal stacked PR containing only the
  lock condition change and the two-writer race test, sized for review by Mahmoud
  and the CTO; (2) before implementation, verify which other flows commit through
  the same dao path and show they are unaffected; (3) document why the lock beats
  the alternative (a database unique constraint on parent linkage would also
  serialize but needs a migration, which is excluded).
- **Decision 3: reformulated after Mahmoud's question; awaiting his pick.** See
  the open-calls section.

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

## Design directives for the runner refactor (Mahmoud, 5 August)

- **Study the Kubernetes and Terraform reconciliation patterns before slice S6
  starts, and borrow their naming and construction where they fit.** Not their
  complexity. Specifically map: spec/status to our desired/applied state;
  Kubernetes' generation and observedGeneration to our catalog generation and
  acknowledgement; Terraform's plan-then-apply to our router producing an explicit
  Plan object that can be logged and tested without executing (shadow routing then
  falls out as "plan without apply"); level-triggered reconciliation (decide from
  current state, never from missed events) as a stated invariant, which our
  fingerprint-travels-with-the-request property already satisfies.
- **The refactor must make per-harness live routes cheaply EXPRESSIBLE without
  implementing them in v1.** Apply-live stays a first-class action kind in the
  action vocabulary and a declared capability in the adapter port; v1 sets every
  harness's tool-catalog capability to reopen-session. The shelved machinery (the
  untrusted acknowledgement, the Pi specs-file channel, the shim listChanged flag)
  is recorded in the backlog with its insertion points named, so enabling one
  harness later is a capability flip plus the shelved component, not a redesign.

## Decisions from Mahmoud's PR review (5 August)

- **Tool-list changes route to session reopen on EVERY harness in v1.** Uniform
  behavior beats a per-harness split where Pi and Claude go live and Codex breaks
  the pattern. The adapter capability matrix stays in the design (flipping one
  harness to live later is a one-line capability change), but v1 sets all three to
  reopen-session. Consequence: the untrusted-acknowledgement machinery, the Pi
  specs-file channel, and the shim listChanged work all leave v1 scope and move to
  the backlog. Codex upstream: a quick source check runs now; filing an upstream
  issue needs Mahmoud's explicit approval first.
- **Match tolerance differs by what the text is.** Prose fields (the instructions
  document, a skill body, descriptions) match exact-first, then retry with
  normalized quotes, dashes, and whitespace; a normalized match must still be
  unique, and the response reports that normalization was used. Script and file
  contents (skill files, code-tool scripts) match exact only, because bytes are
  meaning there. This also settles open decision 1's tension: stored bytes stay
  exact (option A), and the prose-side tolerance lives in matching, not in storage.
- **The build kit must be uncommittable.** Today's bug: agents sometimes commit
  the injected playground tools into their configuration. Three guards: (1)
  read_config reads the STORED revision, which never contains the injected kit, so
  reads are clean by construction; (2) the commit wrapper REJECTS any tool entry
  of the platform kind with a retryable error naming the entries ("these are
  playground tools, not part of your configuration; remove them and retry"); (3)
  one line in the tool instructions says the same up front. Rejection is chosen
  over silent stripping because the spike showed errors teach.

## Arbitrations after the model-usability spike (team lead + Mahmoud, 5 August)

- **The inline marker replaces the operation-level source, and it is named
  `@ag.file`.** One marker family with `@ag.embed`: same shape, different lifetime
  (embed persists and re-resolves; file is consumed at commit and never persists).
  The folder-to-skill codec is dropped from v1; the agent authors skill structure
  itself and references file contents per field. Validated by the spike: the
  operation-level source produced the only silent-corruption failure mode; the
  marker went 91-for-91 across both models.
- **Every retryable error carries one sentence naming the next action.** The
  conflict response instructs: call read_config, re-anchor, resend with the new
  base id. "File not found" lists what exists under the import root. "Text not
  found" returns the nearest lines of the target.
- **Paths may be relative to the workspace root or absolute.** An absolute path
  inside the workspace is normalized by the runner (it knows its own root on each
  platform). Only paths outside the workspace are refused. Agents use absolute
  paths naturally; rejecting them fights the model.
- **The wrapper forgives the two unambiguous selector mistakes** (repeated list
  name; key-field in the `field` slot), and `field` is renamed to `list` in the
  selector. The selector caused 62 percent of all spike failures.
- **No-change detection is mandatory before ship.** A cornered model commits a
  no-op to manufacture success; the `changed` flag and the no-change response stop
  it. Observed once in the spike.
- **Free-text fields on ALL builder tools are optional, with a server-derived
  fallback** (Mahmoud, 5 August: general rule, not commit-only). Reason: free text
  was the site of every DeepSeek argument-corruption failure.
- **Superseded for the commit specifically, by the v3 measurement:** optional is
  not enough. The model volunteers a message anyway and still corrupts it. The
  commit `message` LEAVES the model-facing schema entirely; the server derives it
  from the operations ("edited instructions (2 edits); added skill pdf-tools").
  This also serves issues #5187/#5200 better than a model-written message: the
  derived text is always accurate. The ephemeral R12 `description`, when present,
  is appended as flavor.
- **The v3 instruction document ships as the tool description: ~1.5 KB, ~400
  tokens**, same success rate as the 3.2 KB version (Haiku 55/55, DeepSeek 54/55),
  11-13 percent cheaper per task. Three conditions are part of the decision, not
  optional: the wrapper normalizes the repeated-list-name mistake (it absorbs 12
  percent of Haiku's targets once the teaching leaves the document); every error
  carries a next-step sentence and enriched content; the selector key is `list`
  (measured: zero models ever misused it, and the key-field mistake vanished).
- **`invalid_operation` splits into retryable shape errors and non-retryable
  refusals.** The rename case (key mismatch on replace_item) gets its own
  retryable code with a next-step ("send remove_item then add_item"). An agent
  honoring retryable:false would otherwise dead-end on every rename.

## Settled by the contracts (no longer open)

- Binary and unsupported files: superseded by the `@ag.file` redesign (Mahmoud,
  5 August). There is no folder source, so there is no folder policy. Each
  `@ag.file` reference is one file; an unsupported file fails its own marker with
  a clear reason, and the all-or-nothing commit guarantees nothing partial ever
  lands. `on_unsupported`, `on_executable`, and `persist_executable_capability`
  are all removed; the executable flag and the skill's executable capability are
  ordinary agent-authored fields that the approval card must display. (Was open
  call 5 and the four-layer split.)
- Imports come from a designated root folder, not the whole workspace. (Was open
  call 6.) **Amended by Mahmoud, 5 August: the folder is `.agenta-imports/`, not
  `imports/`.** Two reasons: a dot-folder stays out of sight in shells by default,
  and the Files drawer's existing internal-path filter already hides the
  `.agenta-*` prefix from listings, so non-technical users never see a confusing
  system folder, with zero new UI work. The instructions and every path error name
  the folder explicitly, which the usability spike showed is what the model
  actually reads.
- Cold resume refuses the old approval and asks again; frozen bytes are not persisted
  durably. (Was open call 9.)
- Pi tool removal hides the tool AND drops the runner execution binding; hidden-only
  never ships. (Was open call 7.)
- Embedded skills stay unaddressable in v1; support can be added later without a
  breaking change. (Was open call 3.)

## Open product calls

ALL SIX ARE NOW DECIDED; see 'Product calls confirmed by Mahmoud' above.
Decision 3 closed by default (respect today's permission policy) per Mahmoud's
handoff on 5 August. The original option text stays below for the record.

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
