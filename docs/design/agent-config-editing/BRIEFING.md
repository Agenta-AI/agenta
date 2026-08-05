# Briefing: agent config editing

This document is for review. It is self-contained: you do not need to open any other
file. Comment inline on any line you disagree with. The six open decisions are in
section 9. Everything else is context so those decisions are easy to make.

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

1. **Spikes.** A spike is a small throwaway prototype. Its purpose is not to ship
   code. Its purpose is to test a design against reality before we commit to it, and
   to surface the questions the design forgot to ask. Two Opus teammates each built
   one, in isolated copies of the repo, so nothing touched the main tree.
2. **Contracts, then gates.** A contract is a document that says exactly how one
   piece must behave: its fields, its rules, its errors. We wrote six. Then an
   external reviewer (Codex, a GPT model at its highest reasoning setting) attacked
   the whole design. We fixed what it found, and it reviewed again. Three rounds
   total. No implementation was allowed to start before its part passed.
3. **Vertical slices.** A slice is a small increment that lands alone, with its own
   tests, on its own branch. Slices stack on each other in GitButler lanes, so each
   PR shows only its own change. A separate QA teammate (a Sonnet model) verifies
   each slice after it lands.

## 3. The spikes, in detail

### Spike A: the editing engine (owner: engine-spike, in Python)

The idea to test: can all edits be expressed as a short list of small operations
("find this text, replace with that", "add this one skill", "remove this one tool"),
applied by one pure function? Pure means: the function takes the old configuration
and the operations, and returns the new configuration. No database, no network. That
purity matters, because the same function can then serve two masters later: the real
commit, and a future "run with a temporary change".

What it built: the function, about 700 lines, plus 120 tests. The most important
tests are the **legacy parity** tests: they take eleven old-style deltas (the format
agents use today) and run them through BOTH the old server code and the new engine,
and require identical results. That proves we can switch engines without changing the
behavior of anything that exists.

What it surfaced: 33 small decisions the design had not made (recorded, each with a
reason), and 12 open questions. Examples of both kinds: "what happens when the text
to replace appears twice?" (answer: refuse, ask for more context, like Pi does);
"should an edit create missing parent objects?" (this became part of the contracts);
"what about skills that are references instead of inline content?" (they have no
name to address; deferred to future work, see section 8).

It also found a real bug in today's production code, described in section 5, finding 6.

### Spike B: the runner side (owner: runner-spike, in TypeScript), three parts

**Part 1: prove the folder import.** The story: the agent downloads a skill from the
internet into its sandbox, then commits "add the skill at this folder". For that, the
runner (the service that operates the sandbox) must read the folder, understand it as
a skill (name and description from the SKILL.md header, the text after it as the
body, every other file as a bundled file), and put the result into the commit. The
spike built exactly that and proved it round-trips: a folder written by our own code,
read back by the new code, produces the identical skill. 34 tests.

The spike's biggest finding was about WHERE this read must happen, and it changed the
design. See section 5, finding 3.

**Part 2: can a live harness discover new tools?** Today, changing the agent's tool
list forces a full session rebuild. The question: could a running session pick up a
changed tool list without rebuilding? The spike went into the actual installed
packages of all three harnesses and read their code. The answer surprised us and is
finding 1 in section 5.

**Part 3: pin today's behavior in tests.** Before refactoring anything, you write
tests that assert what the code does TODAY, including its bugs. These are called
characterization tests. When the refactor later changes the behavior on purpose, it
must edit those tests, and that edit is the visible record of the change. The spike
wrote 15 of them, covering the three defects we then fixed in the shipped runner
slice.

## 4. The contracts: yes, written, six of them

Each is a file under `docs/design/agent-config-editing/contracts/`. Together they are
the source of truth for the implementation. What each one says, in one breath:

1. **change-set.md.** The commit format. The two delta forms (old and new, never
   mixed), the seven operations, how a target is addressed (a list of steps, where a
   step is either a field name or "the list entry named X"), the exact matching rules
   for text edits, the error catalog, and the rules for importing files. This is the
   contract the engine implements.
2. **commit-transaction.md.** How a commit becomes a revision safely. One database
   transaction that locks the variant, reads the head, checks the base revision id,
   applies the operations, validates the result, and inserts, so two simultaneous
   commits cannot both win. Also: a commit that changes nothing creates no revision
   and says so, and a stale base always answers with a clear conflict carrying both
   revision ids.
3. **read-config.md.** The read tool. How the agent asks for its configuration or a
   part of it, what the response carries (the revision id, the draft flag), the rule
   that responses return exact stored text (never cleaned, never truncated: too-large
   answers refuse and offer the list of children instead), and the allow-list of
   fields the agent may write at all.
4. **workspace-import.md.** The folder import boundary. Imports come only from the
   `imports/` folder; how the reader defends against symlink tricks on both sandbox
   types; what happens with binary, oversized, or executable files; and what the
   human approval card must show (name, file list with sizes, diff, executable
   flags).
5. **execution-authorization.md.** The security layer for imports. When a human
   approves an import, the runner freezes the exact bytes and issues itself a
   single-use authorization bound to that specific tool call and content. At
   execution it verifies and consumes it. A missing or mismatched authorization fails
   closed. This exists because the sandbox can write into the channel that delivers
   tool calls, so without it a malicious process inside the sandbox could swap the
   content after approval.
6. **adapter-matrix.md.** The per-harness update table. For each harness (Pi, Claude,
   Codex) and each kind of change (model, tools, MCP servers, instructions, skills):
   can a live session take the change, or does it need a session reopen, or a full
   rebuild? Plus the rule that the runner only believes a change was applied when it
   observes an acknowledgement, and that a forged acknowledgement must never grant
   anything (worst case: the model sees a stale tool list).

## 5. What we discovered, with context

**Finding 1: Pi and Claude can take live tool updates. Our own delivery blocks it.**
Context: we assumed a tool-list change always needs a rebuild. The spike read the
harness code and found: Claude Code already contains a handler for the standard "tool
list changed" notification and refreshes its tools in place; it never fires for us
only because OUR tool server never announces that it supports the capability (one
missing flag). Pi has live APIs to register and hide tools mid-session; they are
unreachable only because WE deliver Pi's tool list in a process environment variable,
which is read once at startup and can never change. Only Codex genuinely bakes its
tool configuration at session creation and needs a reopen. Consequence: we feared
live tool updates would need changes in the harnesses, which are other people's
software we cannot patch. They do not. Every missing piece is in our own
repository, and we can ship it whenever we choose. Only Codex stays on a session
reopen.

**Finding 2: the approval pause could leave a session running stale instructions.**
Context: when a run stops and waits for your approval, the session is parked. The
runner labels a parked session with a checksum of the configuration it was built
from, and reuses the session later only when the label matches the next request. The
bug: on the approval path, the runner stamped the label from the INCOMING request
instead of from what the session actually contained. So: edit the configuration while
a run waits for approval, approve, and the resumed session got the NEW label on the
OLD files. The next turn saw a match and happily reused a session running outdated
instructions. Nothing could detect it. Fixed in the shipped runner slice, and fixed
structurally: the labeling parameter no longer exists (see section 6).

**Finding 3: the import approval had to move, or the human approves a lie.**
Context: a tool call travels from the harness to the runner through a shared
directory (the "relay"). The original design resolved the folder into bytes at
execution time, AFTER the human approved. But then the approval card can only show
what the model sent: a path string. The human would approve "imports/pdf-tools"
without seeing a single byte of what gets committed. Worse, the sandbox can write
into that relay directory, so a malicious process could put different content behind
the same path after approval. The fix (now in the contracts): resolve the folder
BEFORE the approval, show the real manifest and diff, freeze the bytes, and commit
exactly the frozen bytes under a single-use authorization.

**Finding 4: two different payloads could produce the same digest.** Context: the
authorization from finding 3 identifies "what was approved" by a digest (a hash) of
the arguments. The existing hashing helper in the runner tries to be clever: if a
string looks like JSON, it parses it first. That means the string `"{\"x\":1}"` and
the actual object `{x:1}` hash the same, so an attacker could substitute one for the
other without changing the digest. The contracts now require a strict serializer for
anything security-bearing: it never reinterprets strings.

**Finding 5: Pi's edit tool is not actually exact.** Context: we lifted our
find-and-replace rules from Pi's edit tool, which is battle-tested. Reading its
source showed that on a failed match it silently retries with normalized quotes,
dashes, and whitespace. For source code files that is helpful. For configuration it
is dangerous: an edit could land on text the caller did not actually write. We took
Pi's contract (exact match, must be unique, all-or-nothing batches) WITHOUT the
fuzzy fallback. This is also what makes open decision 1 matter.

**Finding 6: today's merge code mutates data it does not own.** Context: the current
server code that applies an agent's delta copies objects level by level, shallowly.
Branches it does not touch stay SHARED with the input object. The delete step then
deletes through that shared branch, changing the caller's original data. Today
nothing breaks, purely by luck: the input always happens to be a fresh copy. A shared
engine cannot rely on luck, so the new engine deep-copies, and two tests now pin both
the old and the new behavior so any change is visible.

**Finding 7: the Daytona file API cannot support the import security checks.**
Context: on Daytona (the cloud sandbox), the runner reads sandbox files through
Daytona's file API. That API reports no file permissions and cannot tell a symlink
from a real file. Both matter for imports: the executable bit is content we must
record, and a symlink pointing outside the import folder is the classic escape
trick. The workaround: one shell command inside the sandbox produces a complete
manifest (types, permissions, sizes, real paths) in a single round trip. The
remaining race (content swapped during the read window by a hostile process inside
the sandbox) cannot be fully closed on Daytona; the contract says so honestly and a
test asserts the limitation, so nobody later mistakes the check for a defense.

**Finding 8: the commit endpoint would have eaten the new conflict error.** Context:
the endpoint that saves revisions wraps all errors and returns a generic "nothing
committed" success shape. Our new base check answers conflicts with HTTP 409. Without
an explicit exclusion, that 409 would be swallowed and the agent would see "success,
zero commits", which is exactly the silent behavior this project exists to kill. The
contract names the exclusion.

## 6. The shipped slices, in detail

Both are landed on stacked branches, pushed, and verified by the QA teammate: 1589
runner tests, 778 SDK tests, 63 web tests, zero failures.

### Slice S5: runner safety (14 files)

Context you need: after a turn ends, the runner keeps the sandbox and the harness
session alive ("parked") so the next turn starts in 1.4 seconds instead of 12.5. To
decide whether a parked session is still valid, it compares a checksum of the
configuration. Three behaviors around this were wrong, and this slice fixes them:

1. **A configuration change deleted the sandbox.** The teardown code mapped a
   checksum mismatch to "delete", the most expensive option, and the next request
   then even tried to reconnect to the sandbox it had just deleted. Now: teardown has
   four precise reasons, and a mismatch that only concerns the session stops the
   sandbox instead of deleting it. True incompatibility still deletes, and the
   reconnect pointer is cleared in the same step.
2. **Any commit evicted the session, even a commit that changed nothing.** The
   revision id itself was part of the checksum, so a new revision number alone forced
   a rebuild. Now: the checksum covers content only. Same content, same session.
3. **The stale-instructions bug from finding 2.** The fix is structural: the park
   call simply no longer accepts a label from the caller. The parked session's
   identity comes from what the environment actually holds ("applied state"), which
   only the code that successfully applied a change can update. The bug is not
   fixed; it is unrepresentable.

### Slice S4: the description field (12 files)

Context: you asked for this directly. When the agent calls a builder tool (saving a
revision, running a test), the human sees a bare tool name in the chat. Now every
builder tool accepts an optional short description written by the agent ("committing
the two instruction fixes you approved"). The runner strips the field before the
call reaches the API, so it can never pollute a real payload (there is a test
proving a description cannot overwrite a real field of the same name), and the agent
chat tool card displays it. This is also the pattern the audit trail (decision 6)
will build on.

## 7. The refactoring: partially done, the rest is planned in steps

You asked earlier for a general, clean architecture of the runner so that
fingerprints route to different behaviors instead of always rebuilding. Here is
where that stands.

**The idea, in plain words.** A request describes the configuration it WANTS
("desired state"). The environment records what it actually HAS ("applied state").
On each turn the runner compares the two, and for every difference it asks: what is
the cheapest safe way to get from have to want? Rewrite a file in the workspace?
Tell the live session? Reopen the session on the same sandbox? Or rebuild? Each
harness declares, per kind of change, which of these it supports (the adapter
matrix, contract 6). The old single checksum disappears as a decision-maker; it
survives only as a fast "nothing changed at all" shortcut.

**What is already done (this was S5):** the foundation. Applied state exists and the
environment owns it; teardown reasons are precise; revision numbers no longer count
as changes.

**What comes next, in order. Each step is one slice, and each is explained here in
full.**

### Step 1 (slice S6): move the decision logic out of the web server file

The file is `services/runner/src/server.ts`. It is the HTTP server: it accepts the
run request, checks the caller, and streams the answer back. But today it ALSO
contains the session reuse policy, about 600 lines of it. When a request arrives,
this code looks up the parked session, compares the configuration checksum, the
conversation history, the credentials, and the mount expiry, and then decides: reuse
warm, resume an approval, or rebuild cold. It also re-parks the session after the
turn and picks the eviction reason.

That placement is the problem. Transport code and policy code live in one file, so
the policy cannot be tested without faking the HTTP layer, and every policy change
risks the server. The stale-instructions bug lived exactly in this mixed zone.

The step: create `lifecycle/session-coordinator.ts` and MOVE the decision code into
it, unchanged. The server keeps HTTP, authentication, and request decoding, and
makes one call: run this request through the coordinator. No behavior changes. Every
existing test must still pass. This step is pure preparation: it makes the next
steps safe.

### Step 2 (also S6): shadow routing

The new decision logic works differently from the old one. It splits the request
into facets (model, instructions, skills, tools, MCP servers, credentials), compares
each facet of the DESIRED state against the APPLIED state the environment records,
and produces a plan: a small, readable list of actions, for example "refresh two
workspace files, keep everything else." This is the Terraform idea: plan first,
apply second.

In this step the new logic runs in SHADOW: on every request it computes its plan and
writes it to the log, and then the OLD logic makes the real decision, exactly as
today. We then compare: when the old logic rebuilt and the plan says "one file
refresh would have been enough", that is a logged disagreement. We flip to the new
logic only after production traffic shows the plans are right. Zero risk while we
learn.

### Step 3 (slice S7a): split the environment file into lifecycle units

The file is `services/runner/src/engines/sandbox_agent/environment.ts`, more than a
thousand lines. Today one function does the whole cold start in a fixed order:
create or reconnect the sandbox, push the harness assets, attach the durable mounts,
write the workspace files, probe capabilities, open the harness session. One
function also destroys all of it.

The step: split it into five units, one per lifecycle, still with no behavior
change: sandbox (create, reconnect, stop, destroy), runtime (the agent daemon, its
process environment, its credentials), mount (attach, renew leases), workspace
(write and refresh the instruction and skill files, including deletions), and
harness session (open, load, reopen, close). The environment file becomes a thin
composer that calls the units in order.

Why this must come before step 4: an in-place update means calling ONE unit alone
("refresh the workspace files, touch nothing else"). While the cold start is one
function, that is impossible; you can only run all of it.

### Step 4 (slice S7b): turn on the cheap routes

With the plan from step 2 and the units from step 3, the first in-place routes
switch on:

- Instructions changed: the workspace unit rewrites `AGENTS.md` (or `CLAUDE.md`) in
  the live sandbox. The session survives.
- Skills changed: the workspace unit refreshes the skill folders, including
  deleting folders for removed skills (today's code never deletes).
- Model changed: the session unit calls the existing set-model API
  (`services/runner/src/engines/sandbox_agent/model.ts`) before the next turn.

This is the step where the 12.5-second penalty for a one-word edit dies. Reminder of
an accepted behavior: a live harness does not re-read the instruction file on its
own; we update the file, and the harness reads it when it reads it. That was your
call, and it stands.

### Step 5 (slices S7c0, then S7c): tool changes

Your decision applies: in v1, a tool-list change gets a SESSION REOPEN on every
harness, uniformly. A reopen closes and reopens the harness session on the SAME
sandbox and reloads the native conversation where the harness supports it. It costs
seconds, not the 12.5-second rebuild, and it behaves the same on Pi, Claude, and
Codex.

S7c0 is the foundation fix that must come first: today the turn code
(`services/runner/src/engines/sandbox_agent/run-turn.ts`) mixes the tool
specifications captured at session start with the callback settings of the current
turn. Those two must carry ONE shared generation number, so the tools the model sees
and the tools that execute can never drift apart.

The live-update machinery for Pi and Claude (the notification flag in our tool
server, the file-based delivery for Pi, the acknowledgement rules) is shelved: not
in v1, kept in the backlog with named insertion points, cheap to enable per harness
later because apply-live stays a declared capability in the adapter table.

### Step 6 (slices S7d, S7e): MCP reopen, and credential refresh

S7d: a change to the MCP SERVER LIST has no live path on any harness (we verified:
the session API has no call for it, and the Claude adapter tears the session down
itself when the list changes). So it routes to session reopen, with one fix: the
reopen must positively verify that the native conversation history actually loaded.
Today's check compares only a session id, which can claim continuity that did not
happen.

S7e: today Daytona bakes credentials and environment values into the sandbox at
creation, and the creation checksum treats ANY difference as "different sandbox",
so a rotated API key destroys and recreates the whole thing. The step splits
identity from state: the image, snapshot, and provider define the sandbox and still
rebuild; credentials and timers become refreshable state, delivered to the running
sandbox, at most restarting the agent daemon inside it. A rotated key then costs
seconds and the sandbox survives.

## 8. The implicit decisions we made, with context

Decisions the team made during design without asking you, each recorded and each
reversible by a comment on this file.

1. **Imports come only from a designated folder, named `.agenta-imports/`.**
   (Renamed by Mahmoud during review: a dot-folder, so the Files drawer's existing
   internal-path filter hides it and non-technical users never see a system folder;
   the model finds it through the instructions and the path errors, which is what
   it actually reads.) Context: the first draft allowed
   any path in the workspace, with the approval card as the control. The reviewer
   pushed back: the workspace also holds files the agent created for other reasons,
   possibly secrets, and a human skimming a manifest is not a security boundary. A
   dedicated folder makes intent explicit: things placed there are meant to be
   committed.
2. **Every file reference stands alone, and a bad file fails the whole commit.**
   (Simplified by the `@ag.file` redesign: there is no folder source anymore, so
   the old "folder with unsupported files" policy dissolved.) Context: skill
   content is stored as text, so a PNG or a compiled binary cannot be stored
   faithfully today. Under `@ag.file`, each reference is one file. A file that is
   binary, oversized, or missing fails its own marker with a clear reason, and
   because a commit applies all operations or none, nothing partial ever commits.
   The old opt-in for committing with omissions is gone; if the agent wants to skip
   a file, it simply does not reference it, which is visible in the approval card.
3. **Executable permission is authored explicitly, never derived.** (Also
   simplified by the `@ag.file` redesign: the import-grant layer belonged to the
   folder source and dissolved with it.) Context: `@ag.file` resolves CONTENT
   only. Whether a skill file is executable is a normal field the agent writes
   (`executable: true`) and the approval card must show; whether the stored skill
   may use executables is the existing configuration field, default off, also
   agent-written and card-visible; whether the sandbox actually executes anything
   stays platform policy. Nothing is ever inferred from a file's mode bits.
4. **After a cold resume, an approved import asks again.** Context: the approved
   frozen bytes live with the parked session. If the session dies before execution
   (crash, timeout), the bytes are gone. Reading the folder again would commit
   content the human never saw. Storing the bytes durably would recreate the
   large-payload problem. So the agent asks for approval a second time. Rare and
   slightly annoying, but never wrong.
5. **One text FILE may be imported into one text FIELD.** Context: the strict
   folder rules above would have removed the founding use case: an oversized
   instruction file (#5554). So a single file may be committed into a single
   string field (instructions, a skill body), approved as a readable diff whose old
   side comes from the exact base revision. If that old text cannot be fetched, the
   call fails closed rather than showing a wrong diff. Folders into text fields
   stay forbidden: there is no honest way to present that as a reviewable change.
6. **A removed Pi tool is hidden AND disarmed.** Context: Pi has no API to truly
   deregister a tool. Hiding removes it from what the model sees, but the tool
   would still execute if called by name. So the runner also drops the execution
   binding: a hidden tool that is somehow called anyway does not run.
7. **Referenced skills stay unaddressable in v1.** Context: a skill can be embedded
   by reference instead of inline. A reference has no stable name of its own, so
   name-based operations cannot target it, and the agent must fall back to the old
   whole-list write for that one case. Designing a stable key for references is
   future work; doing it now would delay everything else.
8. **The "did the live update arrive" signal is untrusted.** Context: for live tool
   updates the runner wants to know the harness took the change. Any confirmation
   channel from inside the sandbox can be forged by a process in the sandbox. Rather
   than pretending to secure it, the design makes forgery harmless: the signal only
   advances what the model is SHOWN. What a tool call is actually ALLOWED to do is
   decided runner-side, outside the sandbox, always.
9. **Strict validation applies only to the new format.** Context: turning on strict
   field checking for the old delta format would break shipped playbooks and stored
   callers that today send harmless extra fields. Old format keeps old tolerance;
   the new operations format rejects unknown fields from day one.
10. **Rollout is dark-first with a two-sided kill switch.** Context: naively shipping
    the API first breaks old runners (they would forward unresolved imports). So:
    API support ships disabled, then runner support disabled, then the catalog
    starts advertising the new format. One flag turns it all off, enforced in BOTH
    the API (rejects the new format) and the runner (refuses to read the workspace),
    because a stale harness can still emit the new format after the catalog stops
    advertising it.

## 9. The open decisions (yours)

Answer with one line, for example: `1A 2yes 3B 4no 5no 6yes`, or "go with your
recommendations".

### Decision 1: exact bytes, or clean text once on write?

The agent edits text by quoting it exactly. But text has invisible variety: curly
quotes from a Mac keyboard, CRLF line endings from Windows, two Unicode forms that
look identical on screen. If the stored text holds a curly quote and the agent types
a straight one, the match fails.

- **Option A, exact bytes.** Store exactly what was sent. A failed match is loud, and
  the agent recovers by copying the true text from the read tool. Strong argument: a
  skill folder can contain a Windows batch file, and that file NEEDS its CRLF
  endings. Cleaning would corrupt it. The external reviewer recommends A.
- **Option B, clean once on write.** Normalize on save (one Unicode form, LF
  endings). Matching almost never fails. But stored bytes change on the next save of
  old fields, and file contents would need an exception anyway, which splits the rule.

**Recommendation: A.** One rule, no corruption risk, and the read-before-write loop
makes the occasional failed match cheap.

### Decision 2: the unique-name rule

Named editing needs unique names. Today a config with two skills named `notes` saves
fine and the runner silently drops one at run time. But some existing agents already
carry duplicates, and a global check would make them uncommittable for unrelated
changes.

The proposed rule: a commit may not CREATE a new duplicate; a collection the commit
touches must end up clean; old duplicates elsewhere only warn.

**Recommendation: confirm.** Stricter strands old agents. Looser keeps addressing
ambiguous forever.

### Decision 3: does a folder import always need human approval?

The approval card (name, file list, diff) is the safety control for content the
model never typed. But some runs have no human, for example a nightly automation
that updates its own skills.

- **Option A, always gate.** Safest. Every unattended import stalls forever.
- **Option B, gate by default; an explicit "allow" policy skips it.** A run with an
  explicit allow policy can already execute arbitrary shell commands unattended; an
  import gives it no new power.

**Recommendation: B.**

### Decision 4: may the agent change its own harness?

The harness (Pi, Claude, Codex) is the most identity-defining field: changing it
swaps the runtime and forces a full rebuild. If a user says "switch yourself to
Claude", may the agent commit that itself, or must it point the user to the settings
drawer?

**Recommendation: no, human commit only in v1.** The write-scope is an allow-list;
widening it later is one line, narrowing it later is a breaking change.

### Decision 5: may the agent write outside its own agent section?

The revision also holds workflow-level fields beside `parameters.agent`, including
the service URL and the schemas. Writing the URL would let an agent redirect its own
requests, which is privilege escalation, not configuration editing.

**Recommendation: no.** Commits stay scoped to `parameters.agent`.

### Decision 6: store what the agent did, for audit?

A revision shows the result, not the intent. Storing the operations list on the
commit record ("edited two lines of the instructions, added skill pdf-tools from
imports/") makes every agent commit reviewable afterwards, and a bad commit
diagnosable in seconds. For imports we store the source path and a content digest,
not the bytes, so the record stays small.

**Recommendation: yes.** Small cost, natural companion of the description field.

## 10. Next steps, with context

1. **You answer the six decisions.** Comments on this file, or one line in chat.
   Decision 1 gates the engine; 2 and 6 gate the commit; 3 gates imports; 4 and 5
   gate the read tool's write-scope section.
2. **A final external review.** The reviewer verifies the corrected contracts one
   last time, with your answers folded in. Half a day.
3. **The engine slice.** The seven operations become the real commit path, behind
   the transaction from contract 2. This is the heart: it unlocks cheap instruction
   edits, per-skill edits, per-tool add/remove, and loud conflicts (US-1, 2, 4, 7).
   The prototype and its 120 tests already exist; this is productization, not
   invention.
4. **The read tool.** US-5, and the recovery step for every conflict. Ships together
   with or right before the engine slice, because agents must read before ordered
   edits become visible to them.
5. **The import path.** The folder reader, the freeze-and-authorize flow, and the
   approval card. US-3. The riskiest remaining code; its contracts are the most
   reviewed of the six.
6. **The runner steps from section 7**, in their listed order, each its own slice.
7. **One combined live QA session** on the dev stack across all user stories, by the
   QA teammate. We deferred live QA until it can cover the real stories; unit suites
   have gated every slice so far.
8. **Finalization:** external code review of the full diff, PR descriptions, inline
   code comments, documentation sync, and the stack is yours to merge.
