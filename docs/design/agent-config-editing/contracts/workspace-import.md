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

**Local runs.** The runner opens each file once, with `O_NOFOLLOW`, and derives everything from
that one open file handle.

1. Open the entry with `O_NOFOLLOW`. A symbolic link then fails the open.
2. `fstat` the handle. Read the type, the size, and the mode from the handle, not from the path.
3. Read the content from the same handle.
4. Close the handle.

Directory traversal uses `openat`-style relative descent where the runtime allows it. Node's
`fs.opendir` plus per-entry `O_NOFOLLOW` opens gives the practical equivalent. A symbolic link
inside the tree is refused rather than followed. This is a change from the prototype, which
followed confined links.

The residual window is the directory walk itself. A directory can be swapped between the walk
and the open. The `O_NOFOLLOW` open bounds the damage: the attacker cannot redirect a read to a
target outside the tree through a link, because links do not open at all.

**Daytona runs.** Section 6 defines the manifest. The window there is wider and section 6.4
states it.

### 3.3 Symbolic links are refused, not followed

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

### 5.1 Never derive policy from mode bits

The prototype set `allow_executable_files` to true when any file carried the owner-execute bit.
That converts a filesystem fact into a policy grant. The gate review calls this out as a
separate missing product call. This contract removes it.

### 5.2 The rule

`allow_executable_files` defaults to false. The import never sets it from the filesystem.

The caller states the policy on the operation:

```json
{
  "value_from": {
    "type": "workspace",
    "path": "downloaded-skills/pdf-tools",
    "allow_executable_files": true
  }
}
```

The field defaults to false when absent.

### 5.3 How the mode bit is treated

The runner still reads each file's owner-execute bit. It uses it for two things.

1. It sets `files[].executable` to the observed bit. This preserves the author's intent inside
   the skill package.
2. It reports every executable file in the manifest and on the approval card.

When `allow_executable_files` is false and the folder holds an executable file, the import
**rejects**. It returns `source_executable_not_permitted` and names the files.

The import does not silently clear the bit. A silent clear would produce a skill whose scripts
do not run, and the user would learn this much later.

The materializer's own policy still applies at run time. `resolveSkillDirs` in
`services/runner/src/engines/skills.ts` defaults to `deny`. So an executable file needs three
independent yes answers: the caller's `allow_executable_files`, the skill's stored
`allow_executable_files`, and the sandbox execution policy. That is the intended depth.

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
   The runner then refuses it under section 3.3. `%Y` would follow the link and hide it.
3. **`-maxdepth 8`** bounds the walk inside the command, so a deep or cyclic tree cannot make
   the command run long.

The runner runs a second command to resolve the root itself:

```
realpath -- <absRoot>
```

The result must equal the resolved workspace import root. This catches a symbolic link at the
root.

### 6.3 Reading the content

The runner then reads each accepted file with `readFsFile`. It reads only files the manifest
listed as regular, in-cap, and non-link.

The read count equals the accepted file count. It does not equal the entry count.

### 6.4 The residual window, stated plainly

The manifest and the reads are separate daemon calls. A process inside the sandbox can change a
file between the two. The daemon interface offers no atomic open-and-read, so this window cannot
be closed from the runner.

Three things bound it.

1. The runner verifies each read against the manifest's recorded size. A size change rejects the
   import with `source_changed_during_read`.
2. The runner re-runs the manifest command after the reads finish. Every accepted entry's type,
   mode, and size must be unchanged. Any difference rejects the import.
3. The window is inside the sandbox's own trust boundary. An attacker who can write these files
   can already write to `imports/`, and the run's permission policy governs that write.

This is weaker than the local `O_NOFOLLOW` path. The plan must say so. It must not claim the two
paths give the same guarantee.

### 6.5 Timeouts, cancellation, and memory

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

### 8.1 The manifest

The manifest is the structured record the approval card renders. The runner computes it once, at
mint time.

```
{
  sourcePath,
  itemName,
  operation,                 // add_item | replace_item | set
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

### 8.2 What the card shows

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

### 8.3 Truncation rules

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

## 9. Error codes

| Code | Meaning |
|---|---|
| `source_not_found` | The path does not exist under the import root. |
| `source_escapes_workspace` | The path resolves outside the import root. |
| `source_invalid` | No `SKILL.md`, bad frontmatter, unsafe name, or a malformed path. |
| `source_too_large` | The aggregate cap, the `SKILL.md` cap, or the manifest cap was passed. |
| `source_unsupported_content` | One or more unsupported files, under `on_unsupported: reject`. |
| `source_executable_not_permitted` | An executable file with `allow_executable_files` false. |
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

**TOCTOU.**
- Local: replace a file with a symbolic link between the walk and the open. The open must fail.
- Daytona: change a file's size between the manifest and the read. The import must reject with
  `source_changed_during_read`.
- Daytona: change a file's mode between the manifest and the verification pass. The import must
  reject.

**Unsupported content.**
- A binary file rejects the whole import by default.
- The same folder with `on_unsupported: "omit"` imports, lists the omission, and the omission
  reaches the card.
- An oversized file behaves the same way.
- An aggregate-cap breach rejects under both `reject` and `omit`.

**Executable policy.**
- An executable file with no `allow_executable_files` rejects.
- The same folder with `allow_executable_files: true` imports, and `files[].executable` is true.
- `allow_executable_files` is never true when the caller did not ask for it, whatever the mode
  bits say.

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

This contract adds two fields to that object: `on_unsupported` and `allow_executable_files`.
Under `additionalProperties: false` the model could not write them, so the two contracts
conflict as written.

The conflict must be resolved before either slice starts. The resolution this contract proposes:

**Widen the `value_from` schema in `change-set.md` to hold the two policy fields.**

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["type", "path"],
  "properties": {
    "type": { "const": "workspace" },
    "path": { "type": "string", "minLength": 1 },
    "on_unsupported": { "enum": ["reject", "omit"], "default": "reject" },
    "allow_executable_files": { "type": "boolean", "default": false }
  }
}
```

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
