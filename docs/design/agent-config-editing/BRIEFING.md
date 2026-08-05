# Briefing: agent config editing

This document is for review. It is self-contained: you do not need to open any other
file. Comment inline on any line you disagree with. The six open decisions are at the
end, in section 6.

## 1. What we want to do

An agent in the playground edits its own configuration. Today every edit must resend
the full content. That costs many tokens. It silently wipes list entries the agent
forgets to resend. It fails completely above about 4.8 KB (issue #5554), so a large
instruction file or a downloaded skill cannot be committed at all. The agent cannot
read its own configuration before it writes. A stale write silently overwrites other
people's changes. And any configuration change, however small, throws away the warm
session and pays a 12.5-second rebuild.

The goal: one working stacked PR set where the agent can

- fix one line of its instructions with a small find-and-replace (US-1),
- change one line of one skill without touching the others (US-2),
- install a large downloaded skill by pointing at its folder (US-3),
- add or remove one tool by name (US-4),
- read its configuration, in parts, before writing (US-5),
- get a loud conflict instead of a silent overwrite when the base moved (US-7),
- and keep its warm session across small changes (US-8).

Out of scope, decided earlier: running a temporary change without saving it (US-6).

## 2. The plan, at high level

Three phases.

1. **Spikes.** Two Opus teammates prototype the risky parts in throwaway worktrees, to
   find the unknown unknowns before we commit to a design.
2. **Contracts, then gates.** We write exact behavior documents ("contracts") for each
   piece. An external reviewer (Codex, GPT, highest reasoning) attacks the design.
   We fix, it re-reviews. No implementation starts before its gate passes.
3. **Vertical slices.** Small, separately testable increments land on stacked
   GitButler lanes. A QA teammate (Sonnet) tests each slice. At the end: PR
   descriptions, inline code comments, a final code review, and docs sync.

## 3. What we did

- Both spikes worked. The editing engine prototype passed 120 tests, including proof
  that the old delta format behaves identically through the new engine. The runner
  spike proved the folder-import path end to end.
- We wrote six contracts: the change-set format, the commit transaction, the read
  tool, the import boundary, the approval authorization, and the per-harness update
  matrix.
- The external reviewer ran three gates. Gate one: rejected the loose design, forced
  the contracts. Gate two: found two real security holes on paper (next section).
  Gate three: approved two slices, named the last corrections. All corrections are in.
- Two slices are shipped, on stacked lanes, all suites green (1589 runner tests, 778
  SDK tests, 63 web tests, zero failures):
  - **Runner safety.** A config change now stops the sandbox instead of deleting it.
    A commit that changes nothing keeps the warm session. The stale-config bug on the
    approval path is impossible by construction now: the park call no longer has a
    field anyone could stamp wrongly.
  - **The description field.** Every builder tool call can carry a short agent-written
    note, and the tool card shows it.

## 4. What we discovered

Things nobody knew before this project, found by the spikes and the reviews.

1. **Pi and Claude can take live tool updates. Our own delivery blocks it.** Claude
   Code already handles the "tool list changed" signal; our shim never announces the
   capability. Pi has live tool APIs; we ship its tool specs in an environment
   variable that is read once. Only Codex truly needs a session reopen.
2. **The approval path had a stale-config bug.** Change the configuration while a run
   waits for approval, and the resumed session was re-labeled with the new
   configuration while still holding the old files. Fixed structurally in the shipped
   runner slice.
3. **The approval flow for imports was forgeable on paper.** The relay directory is
   writable from inside the sandbox, and the existing guard passes every "ask"
   record on non-Pi harnesses. The fix is a single-use authorization that binds the
   tool call, the argument digest, and the frozen content digest, and fails closed.
4. **A hashing trick allowed argument substitution.** The existing serializer parses
   JSON-looking strings, so two different payloads could hash identically. The
   authorization now uses a strict serializer that never re-interprets strings.
5. **Pi's edit tool is not exact.** It silently normalizes quotes, dashes, and
   whitespace on a failed match. Good for code files, dangerous for configuration.
   We take its contract (unique match, all-or-nothing) without the fuzzy fallback.
6. **Today's merge code has an aliasing defect.** The server's deep merge shares
   sub-objects with the base, and the delete path mutates the caller's data through
   that sharing. Harmless today by accident. The new engine deep-copies, with tests
   pinning both behaviors.
7. **The Daytona file API cannot support the import security checks.** It exposes no
   permission bits and no symlink information. The import reader uses a one-shot
   manifest command instead, and the remaining read-window race is documented as an
   accepted risk rather than papered over.
8. **The commit endpoint would have swallowed the new conflict error.** It wraps
   errors so a 409 would silently become "nothing committed, success". The contract
   names the exclusion it needs.

## 5. Implicit decisions we made (flag any you want reversed)

Made by the team during design, recorded in decisions.md, each reversible by a
comment on this file.

- Every folder import comes from the `imports/` folder in the workspace, not from
  anywhere in the workspace. A manifest is not a security boundary a human reads.
- A folder with unsupported files (binary, oversized) rejects the whole import unless
  the caller explicitly opts into omission. No silently partial skills.
- Executable permission is four separate things with four owners: the file's own
  mode bit (data), an ephemeral import grant (caller + approver), the stored skill
  capability (the configuration), and the runtime exec policy (the platform).
  Nothing is ever derived from mode bits alone.
- A cold resume after an approved import asks for approval again. We do not store the
  approved bytes durably; that would recreate the large-payload problem.
- Importing one text FILE into one text FIELD (for example a new instruction file) is
  allowed, approved as a readable diff whose old side comes from the exact base
  revision, or the call fails closed. Folders into text fields stay disallowed.
- A removed Pi tool is hidden from the model AND its execution binding is dropped, so
  it cannot run even if called. Pi has no true deregister API.
- Embedded (referenced) skills stay unaddressable by name in v1; editing them still
  needs the old whole-list write. A stable key for them is future work.
- The acknowledgement that a live tool update reached the harness is treated as
  untrusted. A forged acknowledgement can only make the model's tool list stale; it
  can never grant execution of anything.
- The new strict field validation applies to the NEW operations format only. Old
  saved calls and playbooks keep today's tolerant behavior.
- Rollout is dark-first: API support ships disabled, then runner support disabled,
  then the catalog starts advertising. One kill switch, enforced in both the API and
  the runner.

## 6. The open decisions (yours)

Answer with one line, for example: `1A 2yes 3B 4no 5no 6yes`, or "go with your
recommendations".

### Decision 1: exact bytes, or clean text once on write?

The agent edits text by quoting it exactly. But text has invisible variety: curly
quotes from a Mac keyboard, CRLF line endings from Windows, two Unicode forms that
look identical. If stored text holds a curly quote and the agent types a straight
one, the match fails.

- **Option A, exact bytes.** Store exactly what was sent. A failed match is loud, and
  the agent recovers by copying the true text from the read tool. Strong argument: a
  skill folder can contain a Windows batch file, and that file NEEDS its CRLF
  endings. Cleaning would corrupt it. The external reviewer recommends A.
- **Option B, clean once on write.** Normalize on save (one Unicode form, LF).
  Matching almost never fails. But stored bytes change on the next save of old
  fields, and file contents would need an exception anyway, which splits the rule.

**Recommendation: A.** One rule, no corruption risk, and the read-before-write loop
makes the occasional failed match cheap.

### Decision 2: the unique-name rule

Named editing needs unique names. Today a config with two skills named `notes` saves
fine and the runner silently drops one. But some existing agents already carry
duplicates, and a global check would make them uncommittable for unrelated changes.

The proposed rule: a commit may not CREATE a new duplicate; a collection the commit
touches must end up clean; old duplicates elsewhere only warn.

**Recommendation: confirm.** Stricter strands old agents. Looser keeps addressing
ambiguous forever.

### Decision 3: does a folder import always need human approval?

The approval card (name, file list, diff) is the safety control for content the model
never typed. But some runs have no human, for example a nightly automation that
updates its own skills.

- **Option A, always gate.** Safest. Every unattended import stalls forever.
- **Option B, gate by default; an explicit "allow" policy skips it.** A run with an
  explicit allow policy can already execute arbitrary shell commands unattended; an
  import gives it no new power.

**Recommendation: B.**

### Decision 4: may the agent change its own harness?

The harness (Pi, Claude, Codex) is the most identity-defining field: changing it
swaps the runtime and forces a full rebuild. If a user says "switch yourself to
Claude", may the agent commit that, or must it point the user to the settings drawer?

**Recommendation: no, human commit only in v1.** The write-scope is an allow-list;
widening later is one line, narrowing later is a breaking change.

### Decision 5: may the agent write outside its own agent section?

The revision also holds workflow-level fields beside `parameters.agent`, including
the service URL and the schemas. Writing the URL would let an agent redirect its own
requests, which is privilege escalation.

**Recommendation: no.** Commits stay scoped to `parameters.agent`.

### Decision 6: store what the agent did, for audit?

A revision shows the result, not the intent. Storing the operations list on the
commit record ("edited two lines of the instructions, added skill pdf-tools from
imports/") makes every agent commit reviewable afterwards. For imports we store the
source path and a content digest, not the bytes.

**Recommendation: yes.** Small cost, natural companion of the description field.

## 7. Next items, in order

1. You answer the six decisions (comments here, or one line in chat).
2. The external reviewer runs a final gate over the corrected contracts.
3. The engine slice starts: the seven operations behind the commit tool, with the
   base check and validation. This unlocks US-1, US-2, US-4, US-7.
4. The read tool and the import path follow: US-5, then US-3.
5. The remaining runner work lands in steps: coordinator extraction, lifecycle split,
   live updates for instructions, skills, model, and (per harness) tools.
6. One combined live QA session on the dev stack across all user stories.
7. Final code review, PR descriptions, inline comments, docs sync, and the stack is
   yours to merge.
