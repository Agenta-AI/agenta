# Contract: the workspace import boundary

Status: proposed. This contract answers must-fix item 5 of
`research/design-gate-review-codex.md`, and product calls 5, 6, and the eighth call in its
section 5.

This contract defines how the runner reads a folder from its workspace and turns it into a
skill value. It replaces the behavior in the `skill-codec.ts` prototype. The prototype was
lossy by default and derived policy from filesystem facts. Both are wrong.

## 1. Principles

Four rules drive every decision in this document.

1. **Safe by default.** The import must not read a file the user did not intend to share.
2. **Lossless by default.** The import must not silently drop content. A partial skill must
   never be committed without an explicit opt-in.
3. **Policy is explicit.** A filesystem fact never becomes a permission grant.
4. **What is approved is what is committed.** The digest covers the bytes that reach the API.

## 2. The import root

### 2.1 The rule

The runner reads only from a designated import root. The root is `imports/` under the run's
workspace current working directory (`plan.workspace.cwd`).

A `value_from.path` is relative to that root. The path `downloaded-skills/pdf-tools` resolves to
`<cwd>/imports/downloaded-skills/pdf-tools`.

The runner refuses any path that resolves outside the root. It refuses before it reads.

### 2.2 Why not the whole workspace

Open product call 6 in `decisions.md` recommends the whole workspace, with the approval manifest
as the control. The gate review rejects that, and this contract follows the review.

The reason is that a manifest is a poor control against a secret. The workspace holds the
agent's own working files. It holds `AGENTS.md`, harness configuration files, and whatever the
agent wrote during the run. A prompt-injected agent can point `value_from` at any of them. The
human then sees a manifest of file names and sizes. A human approving a skill does not read a
manifest as a security boundary. They see a plausible list and they approve.

A designated root moves the control earlier. The agent must first place content in `imports/`.
That placement is an ordinary file write, which the run's own permission policy already
governs. The import boundary then only has to enforce one thing: stay inside the root.

### 2.3 Root behavior

- The runner creates `imports/` during workspace preparation. It creates it empty.
- The root lives inside the durable workspace, so content placed there survives a warm turn.
- The runner never deletes user content from the root. Cleaning it is the agent's job.
- An import path that names the root itself is refused. The caller must name one folder.

Note for the plan: creating this directory is a change to `prepareWorkspace` in
`services/runner/src/engines/sandbox_agent/workspace.ts`. It belongs in the same slice as the
codec.

## 3. Confinement

### 3.1 Two checks, both required

The runner performs a lexical check and a real-path check. Neither is sufficient alone.

The lexical check rejects, before any filesystem access:

- an absolute path;
- any `..` segment;
- a backslash separator;
- a NUL byte;
- a path longer than 1024 bytes.

The real-path check resolves every symbolic link and compares the result to the resolved root.
The resolved target must be the root or must live under it.

Every file inside the folder gets its own real-path check. A symbolic link deep in the tree
escapes just as well as one at the top.

### 3.2 The TOCTOU window

The prototype used separate `realpath`, `stat`, and `read` calls. A folder can change between
them. An attacker in the sandbox can replace a checked file with a symbolic link to a secret,
after the check and before the read.

This contract closes the window as far as the platform allows. It states plainly where the
window remains.

**Local runs.** The gate 1 version of this contract said that `fs.opendir` plus a per-entry
`open(path, O_NOFOLLOW)` gave the practical equivalent of an `openat` walk. That claim was
wrong, and the correction matters.

`O_NOFOLLOW` refuses a symbolic link at the **final component of the path only**. Every
intermediate directory in the path is still resolved normally, and a symbolic link there is
followed. So an attacker who replaces an intermediate directory between the walk and the open
redirects the open outside the import root, and `O_NOFOLLOW` does not fire.

Concretely, the runner walks to `imports/pdf-tools/scripts/` and lists `extract.py`. It then
opens the path `imports/pdf-tools/scripts/extract.py` with `O_NOFOLLOW`. An attacker replaces
`scripts` with a symbolic link to `/home/user/.ssh` in between. The open resolves through the
link, reaches `/home/user/.ssh/extract.py`, and succeeds. The final component was not a link, so
the flag stays silent.

The fix is a real file-descriptor-relative walk. The runner never rebuilds a full path string
and never re-resolves from the root.

1. Open the import root once. Verify it with `fstat` on the handle.
2. For each directory level, open the child **relative to the parent's descriptor**, with the
   no-follow and directory flags set. In Node this is `fs.opendir` on a handle plus `openat`
   semantics through `fs.promises.open` with a `dir` handle where the runtime exposes it, or a
   small native helper where it does not.
3. Open each file relative to its parent directory's descriptor, with `O_NOFOLLOW`.
4. `fstat` every handle. Read the type, the size, and the mode from the handle, never from a
   path.
5. Read the content from the same handle.
6. Close each handle when its level completes.

This removes the class. A descriptor names an inode, not a path. Replacing a directory in the
tree after the runner holds its descriptor does not move the descriptor. The attacker can only
change what a **new** path lookup would find, and the runner performs none.

Two implementation notes for the plan.

- Node's public API does not expose `openat` directly. `fs.promises.opendir` returns a `Dir` with
  no usable descriptor for relative opens on every platform. So this needs either a narrow native
  helper, or a documented fallback. It is real work, not a flag change. The plan must budget it.
- If the fallback is used, the contract's threat model changes. State it, do not hide it. See
  section 3.4.

**Daytona runs.** Section 6 defines the manifest. The window there is wider, and section 6.5
states plainly that it is not closed.

### 3.3 The threat model, stated once

Two different attackers appear in this contract. They need different answers, and conflating
them is what produced the wrong claim above.

| Attacker | Capability | Where it applies |
|---|---|---|
| **Confused agent** | Writes files through its own tools. Follows an injected instruction to import the wrong folder. Does not race the runner. | Both local and Daytona. |
| **Adversarial sandbox process** | Runs arbitrary code inside the sandbox. Races the runner's filesystem calls deliberately. | Daytona, and a local run whose harness executes untrusted code. |

The designated import root in section 2 defends against the confused agent. It is the primary
control, and it works against both attackers.

The descriptor walk in section 3.2 defends against the adversarial process, on the local path.

Nothing in this contract fully defends against the adversarial process on the Daytona path.
Section 6.5 says so.

### 3.4 If the descriptor walk cannot be built

If the plan decides the native helper is not worth its cost for v1, the local path falls back to
a path-based walk with `O_NOFOLLOW`. That is acceptable only with all three of these:

1. The contract, the plan, and the code comment all state that the local path defends against the
   confused agent and not against an adversarial process.
2. The fallback is not described as a TOCTOU defense anywhere.
3. `contentDigest` still binds what was read. An attacker who wins the race changes what the
   human approves, and the human still sees the substituted content on the card before approving.

Point 3 is the real backstop in the fallback case, and it is weaker than it sounds: it works only
because a human reads the card. It is not a technical control.

### 3.5 Symbolic links are refused, not followed

The prototype followed a link whose target stayed inside the workspace. This contract refuses
every symbolic link inside an import folder.

The reason is the TOCTOU window. A followed link needs a check and then a read, and the two
cannot be made atomic across the Daytona daemon interface. Refusing the link removes the class.

A refused link is an unsupported entry. Section 4.2 defines what happens to it.

## 4. What the import accepts

### 4.1 Required shape

An import folder must hold a `SKILL.md` at its top level. The file must parse as UTF-8. Its YAML
frontmatter must supply a `description`. Its `name` comes from the frontmatter, or from the
folder's own name when the frontmatter omits it.

Everything after the closing frontmatter delimiter is the skill body.

Every other regular file becomes one `files[]` entry.

### 4.2 Unsupported files: reject by default

This is the change the gate review requires. The prototype dropped a binary or oversized file
and committed the rest. That produces a skill the user did not approve.

The rule is now:

**An unsupported file fails the whole import.** The runner returns `source_unsupported_content`.
It lists every offending path. It commits nothing.

A file is unsupported when any of these holds:

- The bytes are not valid UTF-8.
- The file is larger than the per-file cap.
- The entry is a symbolic link.
- The entry is not a regular file or a directory. This covers sockets, devices, and FIFOs.
- The relative path is longer than 255 code points.
- The tree is deeper than 8 levels.

### 4.3 The explicit opt-in for omission

A caller who accepts a partial skill states so. The operation carries:

```json
{
  "value_from": {
    "type": "workspace",
    "path": "downloaded-skills/pdf-tools",
    "on_unsupported": "omit"
  }
}
```

`on_unsupported` accepts `reject` (the default) or `omit`.

Under `omit`:

- The import proceeds without the unsupported files.
- Every omitted path appears in the manifest, with its reason and its size.
- The approval card shows the omissions in their own section, before the file list.
- The runner records the omission list in the interaction row's arguments, because the model
  wrote `on_unsupported` and the user must see what it cost.

Under `omit`, the aggregate byte cap still applies to the files that remain. Exceeding the
aggregate cap always rejects, even under `omit`. A folder that is wholesale too big is a
mistake, not a content type.

This replaces open product call 5 in `decisions.md`. The recommendation there was to drop
binary files with a warning. This contract rejects by default and makes the drop explicit.

### 4.4 Caps

| Cap | Value | On breach |
|---|---|---|
| Per file | 200 000 bytes | Unsupported. Follows `on_unsupported`. |
| Files per folder | 200 | Reject. |
| Aggregate per folder | 2 MiB | Reject, always. |
| Tree depth | 8 | Unsupported. Follows `on_unsupported`. |
| Relative path | 255 code points | Unsupported. Follows `on_unsupported`. |
| `SKILL.md` size | 200 000 bytes | Reject, always. Without it there is no skill. |

The per-file cap matches `SkillFile.content` in
`sdks/python/agenta/sdk/agents/skills/models.py`. Keeping the two equal stops a runner-side
success from becoming a server-side validation failure.

## 5. Executable policy

### 5.1 Two rules

1. A filesystem fact never becomes a permission grant.
2. One field never carries two grants with two owners.

The prototype broke rule 1. The gate 1 contract fixed rule 1 and broke rule 2. Section 5.2
fixes both.

### 5.2 The four-layer split

**Decided by the team lead on 4 August, in answer to gate 2, new problem 10.** The two-field
version below is accepted as written, with the constraint, the pre-read refusal, and the
two-line card. The conservative alternative was rejected: an imported skill that is silently
inert, with no visible reason, is a worse failure mode than an explicit two-line card.

Gate 2 new problem 10 is correct. The gate 1 version of this contract used one field,
`allow_executable_files`, for two different jobs with two different owners and two different
lifetimes.

| Job | Question it answers | Owner | Lifetime |
|---|---|---|---|
| **Import grant** | May this import carry files whose executable bit is set? | The caller, confirmed by the human on the approval card. | One import operation. |
| **Persisted capability** | When this stored skill materializes, may its marked files become executable? | The stored configuration. | The life of the revision. |

Conflating them means one model-authored value silently does both. A caller who only wants the
import to succeed also grants a permanent runtime capability. The caller may not intend that, and
the approval card cannot show the difference, because there is only one field to show.

The split has four distinct layers. Each has one owner.

| Layer | Field | Owner | Where it lives |
|---|---|---|---|
| 1. Data | `files[].executable` | The source file | The persisted skill value |
| 2. Import grant | `value_from.on_executable` | The caller, plus the human approver | The operation. Ephemeral. Never persisted. |
| 3. Persisted capability | `SkillTemplate.allow_executable_files` | The stored configuration | The revision |
| 4. Runtime policy | The materializer's `execPolicy` | The platform or the deployment | `services/runner/src/engines/skills.ts` |

Layer 1 is a fact, not a permission. The runner records the observed bit whatever the policy
says. Layer 4 already exists and already defaults to `deny`.

The two new fields sit on the FOLDER source, because both describe this one import. The file
source used by `set` carries neither. Section 5.5 explains why.

```json
{
  "value_from": {
    "type": "workspace",
    "path": "downloaded-skills/pdf-tools",
    "on_unsupported": "reject",
    "on_executable": "reject",
    "persist_executable_capability": false
  }
}
```

- `on_executable` accepts `"reject"` (the default) or `"import"`. Under `"reject"`, an
  executable file in the folder rejects the whole import with
  `source_executable_not_permitted`. Under `"import"`, the import proceeds and records the bits.
- `persist_executable_capability` is a boolean, default false. It sets
  `SkillTemplate.allow_executable_files` on the committed value.

One constraint binds them: **`persist_executable_capability: true` requires
`on_executable: "import"`.** The reverse is allowed. A caller may import the bits without
granting the runtime capability, which produces a faithful copy of the folder that still cannot
execute anything until someone grants layer 3 deliberately. A caller may not grant the runtime
capability for bits it never permitted itself to read.

Violating the constraint is `invalid_operation`, refused before any workspace read.

The approval card shows the two as separate lines, because they are separate grants:

```
Executable files:  3 imported          (on_executable: import)
Runtime execution: NOT granted         (persist_executable_capability: false)
```

**Why both fields sit on `value_from` rather than one moving to the operation.** The persisted
capability is a property of the skill, so at first sight it belongs on the operation's `value`.
But with `value_from` the runner generates the whole value, so the caller has no `value` object
to write it into. Putting it on the operation instead would make one operation carry a field that
only applies when a sibling field is present, which is worse. Keeping both on `value_from` keeps
the import declaration self-contained and keeps the constraint checkable in one place.

**The rejected alternative, recorded.** One option was to drop
`persist_executable_capability`, always commit `allow_executable_files: false` on import, and
require a separate explicit operation to grant the runtime capability afterwards. It needs no
constraint, so it is simpler. The team lead rejected it on 4 August: an imported skill whose
scripts do not run, with nothing on screen to say why, is a worse failure mode than one extra
line on the approval card. Do not reintroduce it as a simplification.

### 5.3 What the runner never does

The runner never sets any of the four layers from the filesystem.

The prototype set `allow_executable_files` to true when any file carried the owner-execute bit.
That converts a filesystem fact into a policy grant, and it is exactly what layer 1 versus layer
3 exists to prevent. It is removed.

The import also does not silently clear a bit. A silent clear would produce a skill whose scripts
do not run, and the user would learn this much later. An executable file the caller did not
permit rejects the import instead.

### 5.4 How the mode bit is treated

The runner reads each file's owner-execute bit. It uses it for three things.

1. It sets `files[].executable` to the observed bit. This is layer 1.
2. It reports every executable file in the manifest and on the approval card.
3. It compares the set against `on_executable` and rejects the import when the grant is absent.

At run time an executable file needs three independent yes answers: `on_executable: "import"` at
the moment of import, the stored `allow_executable_files`, and the sandbox execution policy in
`resolveSkillDirs`. That is the intended depth, and each answer has a different owner.

### 5.5 Two source shapes, two schemas

`change-set.md` section 5.1.3 defines two source schemas. The split matters here, because it
decides which policy fields the import resolver reads.

| Source shape | Used by | Carries |
|---|---|---|
| **Folder** | `add_item`, `replace_item` | `type`, `path`, `on_unsupported`, `on_executable`, `persist_executable_capability` |
| **File** | `set` | `type` and `path` only |

The file source carries no policy field, because neither one has a meaning for it.

- `on_unsupported` chooses between refusing a folder and omitting some of its files. A
  single-file source has nothing to omit. An unsupported single file always rejects, with
  `source_unsupported_content`.
- `on_executable` and `persist_executable_capability` govern a stored skill file's executable
  bit. A `set` writes text into an existing string field. It never creates a file entry, and it
  never changes an existing entry's `executable` flag. So there is nothing for either grant to
  govern.

A policy field on a file source is `invalid_operation`. The schema refuses it first, because
both source schemas set `additionalProperties: false`.

The import resolver therefore has two entry points, not one with a mode flag. The folder path
produces a `SkillTemplate` value and a file manifest. The file path produces one string and its
digest. They share the confinement rules in section 3, the caps in section 4.4, and the Daytona
reader in section 6. They share nothing else.

## 6. The Daytona reader

### 6.1 Why a manifest

On Daytona the workspace lives inside the sandbox. The runner must read it over the daemon
interface. That interface cannot answer two questions the codec needs.

`FsEntry` and `FsStat` in `node_modules/sandbox-agent/dist/index.d.ts` carry `entryType`,
`name`, `path`, `size`, and `modified`. They carry no permission mask. So `isExecutable` has no
answer.

`FsEntryType` is `"file" | "directory"` only. A symbolic link is reported as its target's type.
There is no `realpath` equivalent. So the confinement check has no answer.

Both gaps are closed with one process execution per import, not one per file. One execution per
file would be far too slow for a folder of any size.

### 6.2 The manifest command

The runner runs one command. It runs it with an argument vector, never through a shell.

```
find <absRoot> -mindepth 0 -maxdepth 8 -printf '%y\0%m\0%s\0%P\0'
```

The fields are the entry type, the octal mode, the size in bytes, and the path relative to the
root.

Three framing rules make this safe.

1. **NUL separation.** Fields and records are separated by NUL bytes. A file name may hold a
   newline, a tab, a quote, or a backslash. It may not hold a NUL. So NUL is the only safe
   separator. The prototype's tab-and-newline framing was not safe.
2. **`%y` not `%Y`.** `%y` reports the type of the entry itself. A symbolic link reports `l`.
   The runner then refuses it under section 3.5. `%Y` would follow the link and hide it.
3. **`-maxdepth 8`** bounds the walk inside the command, so a deep or cyclic tree cannot make
   the command run long.

The runner runs two more commands to resolve paths. Both matter, and the gate 1 version got the
comparison wrong.

```
realpath -- <workspaceImportRoot>      # -> R
realpath -- <absImportFolder>          # -> F
```

`<absImportFolder>` is the folder the caller named, which is `<workspaceImportRoot>` joined with
`value_from.path`. Section 2.1 requires the caller to name a folder BELOW the import root, so `F`
and `R` are almost never equal.

**The test is descendant, not equality.** `F` passes when `F` equals `R`, or when `F` starts with
`R` plus a path separator. The gate 1 text required `F` to equal `R`, which would have rejected
every valid import. That was a straight error.

The runner compares the resolved strings after it normalizes each to a single trailing form. It
must not compare unresolved paths, because that is what the symbolic-link check exists to defeat.

The same descendant test applies to every entry in the manifest. `find` prints `%P`, the path
relative to the folder it walked, so an entry cannot escape through its printed name. But a
directory in the tree may still be a link, and rule 2 above makes `find` report it as `l`. The
runner refuses it.

### 6.3 What the manifest does NOT establish

`find` resolves paths through the sandbox's own view of the filesystem, at the moment it runs.
It is a snapshot of names, not a set of handles. The runner cannot hold a descriptor across the
daemon interface, so it cannot repeat the local descriptor walk here.

So the Daytona path establishes:

- what entries existed when `find` ran;
- their type, mode, and size at that moment;
- that the folder resolved under the import root at that moment.

It does not establish that any of those facts are still true when `readFsFile` runs.

### 6.4 Reading the content

The runner then reads each accepted file with `readFsFile`. It reads only files the manifest
listed as regular, in-cap, and non-link.

The read count equals the accepted file count. It does not equal the entry count.

### 6.5 The residual window, stated plainly

**The two-pass manifest does not stop an adversarial sandbox process. It must not be described as
a snapshot.**

The manifest and the reads are separate daemon calls. The daemon interface offers no atomic
open-and-read, and it hands the runner no descriptor to hold. So the runner has no way to bind a
read to the inode the manifest saw.

The gate 1 version listed a second manifest pass as a bound. It is not one, for a concrete
reason. An attacker who controls a process inside the sandbox can:

1. wait for the first `find` to finish;
2. replace a file with a symbolic link, or with different content of the **same size**;
3. let the runner's `readFsFile` return the substituted bytes;
4. restore the original before the second `find` runs.

Both passes then agree. The size check agrees. The mode check agrees. The runner commits content
no human approved, and every check it performed passed.

The size check and the second pass do have value. They catch a **non-adversarial** change: an
agent still writing to the folder, a background process, a partially written download. That is
worth keeping. It is a consistency check, not a security control, and this contract now calls it
one.

What actually bounds the Daytona path:

1. **The import root.** An attacker must first place or modify content under `imports/`. The
   run's own permission policy governs that write. This is the primary control, and it holds
   against the confused agent.
2. **The human on the approval card.** The card shows the bytes the runner actually read. A
   substitution changes what the human sees before they approve it.
3. **`contentDigest`.** What the human approved is what the API receives. A later change on disk
   cannot alter the committed value.

None of the three stops a well-timed swap by a process that already runs arbitrary code inside
the sandbox. Against that attacker, on Daytona, this contract does not claim protection.

That is an honest position, and it is defensible: an attacker who already runs arbitrary code in
the sandbox can also write whatever it wants directly into `imports/` and let the import read it
legitimately. The race adds little to what that attacker can already do. What the race does add
is the ability to defeat the human's review, and the plan must record that as an accepted risk
rather than a solved problem.

The plan and the code comment must both say: the Daytona import path is weaker than the local
descriptor walk, and it is not a TOCTOU defense.

### 6.6 Timeouts, cancellation, and memory

| Control | Value |
|---|---|
| Manifest command timeout | 10 seconds |
| `realpath` command timeout | 5 seconds |
| Whole-import deadline | 30 seconds |
| Abort signal | The turn's signal, combined with the deadline |
| Manifest output cap | 1 MiB. A larger output rejects with `source_too_large`. |
| Concurrent file reads | 4 |
| Peak buffered bytes | The aggregate folder cap, 2 MiB |

The runner must not buffer the whole manifest and the whole content at once beyond these caps.
It accumulates content into the frozen-value store as it reads, and it checks the aggregate cap
on every append.

On cancellation the runner stops issuing daemon calls, releases every buffered byte, and mints
no authorization record. It does not wait for in-flight reads to finish before releasing.

## 7. The digest

### 7.1 What it covers

`contentDigest` is SHA-256 over the canonical serialization of the **complete resolved value**.
It covers `name`, `description`, `body`, every `files[]` entry's `path`, `content`, and
`executable`, plus `disable_model_invocation` and `allow_executable_files`.

These are the bytes the runner sends to the API. The digest therefore proves that what was
approved is what was committed.

The digest does **not** cover the source folder's bytes on disk, the file modification times, or
the manifest. Those are inputs, not the committed value.

### 7.2 Determinism

The value must serialize the same way every time, or the digest is useless.

- `files[]` is sorted by `path`, using byte-wise comparison of the UTF-8 encoding.
- Object keys are sorted by the canonical serializer.
- The serializer is `canonicalJson` in `services/runner/src/responder.ts`, the same function the
  execution authorization uses.

### 7.3 The manifest digest

`manifestDigest` is SHA-256 over the approval manifest, defined in section 8. It exists so the
approval user interface can prove which manifest the human saw. It is separate from
`contentDigest` because the manifest is a truncated view and the content is not.

## 8. The approval manifest and the card

### 8.0 Two presentation modes

The import has two source shapes, so the card has two modes. Section 5.5 defines the split.

| Mode | Source | Operation | The card shows |
|---|---|---|---|
| **Item mode** | Folder | `add_item`, `replace_item` | A named item, a file manifest, and the body. Sections 8.1 to 8.3. |
| **Single-text mode** | One file | `set` | A unified diff of one string field. Section 8.4. |

The runner selects the mode from the source shape, never from a caller-supplied flag. A folder
always renders the item mode. A file always renders the single-text mode.

One rule holds in both modes, and it is the reason both exist: **the card never shows only a byte
count and a path.** A human approves a readable change, or the runner does not ask.

### 8.1 The manifest, item mode

The manifest is the structured record the approval card renders. The runner computes it once, at
mint time.

```
{
  mode: "item",
  sourcePath,
  itemName,
  operation,                 // add_item | replace_item
  intent,                    // "add" | "replace"
  totalBytes,
  fileCount,
  allowExecutableFiles,      // the caller's explicit policy
  executableFiles: [path],
  omitted: [{path, reason, bytes}],
  descriptionText,
  bodyDigest,
  bodyBytes,
  files: [{path, bytes, digest, executable}],
  contentDigest,
  catalogGeneration
}
```

Every file carries its own digest. A user who wants to verify one file can do so without the
whole content.

### 8.2 What the card shows, item mode

The card shows, in this order:

1. The intent and the item name. "Add skill `pdf-tools`" or "Replace skill `pdf-tools`".
2. The source path.
3. The omission section, when `omitted` is non-empty. This comes before the content, because it
   is what the user is most likely to miss.
4. The executable section, when `executableFiles` is non-empty. It names the policy value.
5. The description, in full.
6. The body, or a diff against the current body for a replace.
7. The file list, with sizes.
8. The totals and `contentDigest`.

### 8.3 Truncation rules, item mode

Long content must not be dropped silently and must not flood the card.

| Element | Rule |
|---|---|
| Description | Never truncated. It is capped at 1024 code points already. |
| Body, on add | First 4000 code points, then a marker giving the omitted count and `bodyDigest`. |
| Body, on replace | A unified diff, capped at 400 lines. Beyond that, show the changed-line counts and `bodyDigest` for both sides. |
| File list | First 50 files by path order, then a marker giving the remaining count. |
| File content | Not shown on the card. Each file shows its path, size, digest, and executable flag. |
| Omission list | Never truncated. It is capped by the file count already. |

The card must state, in words the user reads, that `contentDigest` covers the **full** value and
not the truncated view. Without that sentence, a truncated card implies a partial approval.

The user interface must offer a way to see the full body and any single file's content on
demand. The runner serves that from the frozen value, so what the user reads is what will
commit.

### 8.4 Single-text mode: `set` from one file

`change-set.md` section 5.1.1 allows `value_from` on `set` under three conditions. The third one
is a presentation condition, and this section owns it. The founding use case of the project is
an oversized instruction file, so this path must exist and it must read well.

#### 8.4.1 The manifest, single-text mode

```
{
  mode: "single_text",
  sourcePath,
  targetField,               // a readable name, e.g. "instructions" or "skill pdf-tools / body"
  target,                    // the structured target from the operation
  newBytes,
  newLines,
  newDigest,
  oldAvailable,              // boolean
  oldBytes,                  // present only when oldAvailable
  oldLines,                  // present only when oldAvailable
  oldDigest,                 // present only when oldAvailable
  diff,                      // present only when oldAvailable
  addedLines,                // present only when oldAvailable
  removedLines,              // present only when oldAvailable
  contentDigest,             // equals newDigest in this mode
  catalogGeneration
}
```

There is no `itemName`, no `files`, no `omitted`, and no executable section. A `set` writes one
string. None of those concepts applies.

#### 8.4.2 What the card shows, with old text available

1. The target field, by its readable name. "Replace the instructions" or "Replace the body of
   skill `pdf-tools`".
2. The source path.
3. A **unified diff** of the old text against the new text.
4. The changed-line counts, as added and removed.
5. The old and new sizes, in bytes and lines.
6. `contentDigest`.

The diff is the substance of the card. Items 4 to 6 support it. They never replace it.

The old side comes from the configuration the runner holds for the current run. That
configuration can be behind the head. This is safe, because the base check answers 409 on drift
(`commit-transaction.md` section 6), so the human never approves a diff that then commits
silently against a different base. The card does not need to warn about this.

#### 8.4.3 What the card shows, with old text unavailable

The runner may not hold the old text. The field may sit outside the configuration the run
carries, or the run may carry no configuration at all.

In that case the card shows the **complete new text**, and it says plainly why:

```
No previous text was available, so this shows the complete new content.
```

Two rules bind this case.

- **The new text is shown in full.** It is not truncated to a preview. The human has no diff to
  read, so the full text is the only thing that makes the change reviewable.
- **The card never falls back to a byte count and a path.** That is the failure mode condition 3
  exists to prevent, and it is the one this mode must never reach.

If the complete new text exceeds the size the interface can render, the interface scrolls it. It
does not summarize it. The 200 000-byte per-file cap in section 4.4 bounds the worst case.

#### 8.4.4 Truncation rules, single-text mode

| Element | Rule |
|---|---|
| Diff, old text available | Capped at 400 lines, matching the item mode's replace rule. Beyond that, show the first 400 diff lines, then the changed-line counts and both digests. |
| New text, old text unavailable | **Never truncated.** See section 8.4.3. |
| Line counts and digests | Never truncated. |

The 400-line diff cap is a display cap only. The card must state that `contentDigest` covers the
full new text, exactly as section 8.3 requires for the item mode. The interface must offer the
full diff and the full new text on demand, served from the frozen value.

#### 8.4.5 What this mode does not do

- It does not read policy fields. The file source carries `type` and `path` only. See section
  5.5.
- It does not create a field. `change-set.md` section 5.1.1 requires the target to exist and to
  hold a string already, because a field with no old text has no honest diff.
- It does not accept a folder. A directory source, or a source matching more than one file, is
  `source_invalid` and the runner refuses it before it reads any content.

## 9. Error codes

| Code | Meaning |
|---|---|
| `source_not_found` | The path does not exist under the import root. |
| `source_escapes_workspace` | The path resolves outside the import root. |
| `source_invalid` | No `SKILL.md`, bad frontmatter, unsafe name, a malformed path, or a folder / multi-file source on `set`. |
| `source_too_large` | The aggregate cap, the `SKILL.md` cap, or the manifest cap was passed. |
| `source_unsupported_content` | One or more unsupported files, under `on_unsupported: reject`. |
| `source_executable_not_permitted` | An executable file under `on_executable: reject`. |
| `source_changed_during_read` | The folder changed between the manifest and the read. |
| `source_read_failed` | A daemon or filesystem error. |
| `source_timeout` | The import passed its deadline. |
| `source_cancelled` | The turn aborted. |

Every code carries the offending paths, up to 20, and a count of the rest.

## 10. Test obligations

**Confinement.**
- Traversal, absolute path, backslash, and NUL are refused before any read.
- A symbolic link at the folder root is refused.
- A symbolic link inside the folder is refused, even when its target stays inside the workspace.
- A path outside `imports/` but inside the workspace is refused.
- A valid folder BELOW `imports/` is accepted. This is the descendant test in section 6.2, and
  the gate 1 equality test would have failed it. Add it as a regression guard.
- `imports/` itself is refused, per section 2.3.

**TOCTOU, local.**
- Replace the FINAL component with a symbolic link between the walk and the open. The open must
  fail.
- Replace an INTERMEDIATE DIRECTORY with a symbolic link pointing outside the import root,
  between the walk and the open. The descriptor walk must still read the original file. This is
  the case the gate 1 contract claimed to stop and did not. It must fail against a path-based
  walk and pass against the descriptor walk.
- If the fallback in section 3.4 ships, the intermediate-directory test is marked as a KNOWN
  FAILURE with a reference to section 3.4. It must not be deleted, and it must not be marked
  passing.

**TOCTOU, Daytona.**
- Change a file's size between the manifest and the read. The import must reject with
  `source_changed_during_read`.
- Change a file's mode between the manifest and the verification pass. The import must reject.
- Swap content of the SAME SIZE in for the read and swap it back before the verification pass.
  The import SUCCEEDS and commits the substituted bytes. This test asserts the documented
  weakness in section 6.5. It exists so nobody later believes the two-pass manifest is a
  snapshot. Name it accordingly.

**Unsupported content.**
- A binary file rejects the whole import by default.
- The same folder with `on_unsupported: "omit"` imports, lists the omission, and the omission
  reaches the card.
- An oversized file behaves the same way.
- An aggregate-cap breach rejects under both `reject` and `omit`.

**Executable policy.**
- An executable file under the default `on_executable: "reject"` rejects the import.
- The same folder with `on_executable: "import"` imports, and `files[].executable` is true.
- `on_executable: "import"` alone leaves `SkillTemplate.allow_executable_files` FALSE.
- `persist_executable_capability: true` sets it true, and only then.
- `persist_executable_capability: true` with `on_executable: "reject"` is `invalid_operation`,
  and performs no workspace read.
- `SkillTemplate.allow_executable_files` is never true because of a mode bit. Import a folder
  full of executable files with `persist_executable_capability` absent; the stored value is
  false.
- The approval card shows the import grant and the runtime grant as two separate lines.

**Single-text mode (`set` from one file).**
- A folder source on `set` is `source_invalid`, refused before any content read.
- A source matching more than one file is `source_invalid`.
- A policy field on a file source is refused by the schema.
- With old text available, the card renders a unified diff plus changed-line counts.
- With old text UNAVAILABLE, the card renders the COMPLETE new text and states why. Assert on
  the full text, not on its presence.
- The card never renders only a byte count and a path. Assert this for both the available and
  the unavailable case.
- A diff longer than 400 lines truncates the DIFF and still states that the digest covers the
  full text.
- New text longer than 400 lines with no old text is NOT truncated.
- A target that does not exist is `target_not_found`. A non-string target is
  `target_type_mismatch`. Neither reads any content.

**Digest.**
- Two imports of an unchanged folder give the same `contentDigest`.
- Changing one byte in one file changes `contentDigest`.
- The value sent to the API digests to the approved `contentDigest`.

**Daytona framing.**
- A file whose name holds a newline, a tab, a quote, and a backslash imports correctly.
- A manifest larger than 1 MiB rejects.
- A manifest command that exceeds its timeout rejects and releases every buffer.
- Cancelling the turn mid-import releases every buffer and issues no further daemon calls.

**Card.**
- A body longer than the truncation cap shows the marker and the digest.
- A folder with 200 files shows 50 and a remaining count.
- The card states that the digest covers the full value.

## 11. Conflict with `change-set.md` — resolved

**Status: resolved on 4 August. The team lead accepted this contract's position.**
`contracts/change-set.md` section 5.1 now carries both policy fields, and section 2.1
lists them in the model-visible catalog schema. The rest of this section stays for the
record.

`contracts/change-set.md` section 5.1 defined `value_from` as a closed object:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["type", "path"],
  "properties": {
    "type": { "const": "workspace" },
    "path": { "type": "string", "minLength": 1 }
  }
}
```

This contract adds three fields to the FOLDER source: `on_unsupported`, `on_executable`, and
`persist_executable_capability`. Under `additionalProperties: false` the model could not write
them, so the two contracts conflicted as written.

`change-set.md` section 5.1.3 has since split the source into two schemas, which resolves the
shape of the conflict. The field names there now match this section: the folder source
carries `on_unsupported`, `on_executable`, and `persist_executable_capability` beside `type`
and `path`, and the file source carries `type` and `path` only. (An earlier draft of this
paragraph flagged a stale name; the two files were edited concurrently and the flag was
outdated on arrival. Verified in the current text of both files.)

The conflict must be resolved before either slice starts. The resolution this contract proposes:

**Widen the `value_from` schema in `change-set.md` to hold the three policy fields.**

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["type", "path"],
  "properties": {
    "type": { "const": "workspace" },
    "path": { "type": "string", "minLength": 1 },
    "on_unsupported": { "enum": ["reject", "omit"], "default": "reject" },
    "on_executable": { "enum": ["reject", "import"], "default": "reject" },
    "persist_executable_capability": { "type": "boolean", "default": false }
  }
}
```

The constraint in section 5.2 — `persist_executable_capability: true` requires
`on_executable: "import"` — is not expressible cleanly in this schema. Enforce it in the
runner's own validation and return `invalid_operation`. Do not encode it as a JSON Schema
dependency; a catalog schema the model reads should stay simple, and the runner refuses the
combination before any workspace read either way.

Three reasons this is the right side to change.

1. Both fields are decisions the caller makes about one import. They belong with the import
   declaration, not on the operation and not on the envelope. Another operation in the same
   commit may import a different folder with a different answer.
2. The engine never sees them. `change-set.md` already states that the engine refuses
   `value_from` with `source_invalid`, and that the runner resolves it first. The runner strips
   the whole object and replaces it with `value`. So widening the schema adds no engine surface.
3. The schema is the model-facing catalog schema. The model must be able to write the fields, or
   the defaults become the only reachable behavior. Reject-by-default with no way to opt in would
   make an ordinary skill folder with one binary asset permanently uncommittable.

The alternative is to keep `value_from` closed and put the two fields on the operation. This
contract does not recommend it. It separates the policy from the source it governs, and it
breaks when one commit imports two folders with different answers.

Owner: the engine spike owns `change-set.md`. Both edits are done. `change-set.md`
section 5.1 holds the widened `value_from` schema and points back to sections 4.2, 4.3,
and 5.2 of this contract. `change-set.md` section 2.1 lists both fields in the
model-visible catalog schema and repeats that the runner strips the object.

## 12. Decisions this contract changes

| Existing item | Change |
|---|---|
| `decisions.md` open call 5 | Binary files no longer drop with a warning. They reject by default, with `on_unsupported: "omit"` as the explicit opt-in. |
| `decisions.md` open call 6 | The reach is the designated `imports/` root, not the whole workspace. |
| `spikes/runner-spike.md`, "Codec gaps" | `allow_executable_files` is no longer derived. Binary and oversized files no longer drop silently. Symbolic links are no longer followed. |
| `plan.md` | Add the `imports/` root creation to the workspace slice. Add the Daytona reader as its own unit of work. |

## 13. Gate 2 resolution

| Gate 2 point | Where it is answered |
|---|---|
| New problem 3: local `O_NOFOLLOW` does not protect a replaced intermediate directory | §3.2 retracts the gate 1 claim, shows the concrete attack, and specifies a descriptor-relative walk. §3.3 names the two attackers. §3.4 defines the honest fallback if the native helper is not built. §10 adds the intermediate-directory test, including its known-failure form. |
| New problem 4: Daytona root check is equality, and the two-pass manifest is still raceable | §6.2 replaces equality with a descendant test and explains why the gate 1 text would have rejected every valid import. §6.3 states what the manifest does not establish. §6.5 retracts the two-pass bound, walks the same-size swap attack step by step, demotes the passes to a consistency check, and states what actually bounds the path. §10 adds a test that ASSERTS the weakness. |
| New problem 10: `allow_executable_files` conflates import grant and persisted capability | **Decided 4 August.** §5.2 splits the concern into four layers with one owner each: `on_executable` is the import grant, `persist_executable_capability` is the persisted capability, and the second requires the first. Violation is refused before any workspace read. The card shows two separate lines. §5.3 and §5.4 follow. §5.5 keeps both fields off the file source. §11 widens the folder schema. §10 replaces the executable tests. The conservative alternative is recorded as rejected, with its reason. |
| New problem 9: the approval manifest cannot describe every allowed operation | **Resolved jointly.** `change-set.md` §5.1.1 allows `value_from` on `set` under three conditions and §5.1.3 splits the source schema. This contract owns condition 3. §8.0 defines the two presentation modes and the rule they share: the card never shows only a byte count and a path. §8.4 defines the single-text mode, including the diff, the counts, the digests, and the no-old-text case that shows the COMPLETE new text and says why. §5.5 records the source-schema split. §10 adds ten single-text tests. |
| Item 5 status: default policy, limits, manifest, Daytona framing | Unchanged from gate 1. §2, §4, §6.2, §6.6, §7, §8.1 to §8.3. |

Not resolved here, by design:

- Gate 2 item 7, the slice plan, belongs to `plan.md`. §2.3, §3.2, and §6 each name work the
  plan must budget.
