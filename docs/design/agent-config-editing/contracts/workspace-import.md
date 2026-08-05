# Contract: the workspace import boundary

Status: proposed, and **partly superseded by the 5 August consolidation**. This contract
answers must-fix item 5 of `research/design-gate-review-codex.md`.

> **What the consolidation changed.** `change-set.md` is authoritative for all of it.
>
> | Was | Is | Where |
> |---|---|---|
> | a `value_from` object on an operation, resolving a FOLDER | an inline `{"@ag.file": "<path>"}` marker resolving ONE FILE, in any string position of a value | `change-set.md` 6.1, 6.2 |
> | the folder-to-skill codec | dropped from v1; the agent authors skill structure itself | `change-set.md` 6.2 |
> | `on_unsupported`, `on_executable`, `persist_executable_capability` | all removed. `executable` and `allow_executable_files` are ordinary agent-authored fields the approval card shows | `change-set.md` 6.2 |
> | the import root `imports/` | **`.agenta-imports/`** | `change-set.md` 6.3 |
> | paths relative to the import root only | relative to the workspace root, or absolute inside the workspace; the runner normalizes both | `change-set.md` 6.3 |
>
> **What still stands, unchanged and still needed:** the designated-root argument (section
> 2.2), path confinement and the descriptor-relative walk (section 3), the symbolic-link
> refusal, the per-file and aggregate caps (section 4.4), the Daytona manifest reader and its
> stated residual race (section 6), the digest rules (section 7), and the approval card and
> its truncation rules (section 8). Read every "folder" in those sections as "the file a
> marker names", and read every "the import" as "one marker's resolution".
>
> Sections 4.2, 4.3, 5.2, and 8.1's `allowExecutableFiles` field are the superseded parts.
> Rewriting them is runner-spike's, who owns this file.

This contract defines how the runner reads content from its workspace and hands it to a
commit. It replaces the behavior in the `skill-codec.ts` prototype. The prototype was
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

The runner reads only from a designated import root. The root is `.agenta-imports/` under the run's
workspace current working directory (`plan.workspace.cwd`).

A `value_from.path` is relative to that root. The path `downloaded-skills/pdf-tools` resolves to
`<cwd>/.agenta-imports/downloaded-skills/pdf-tools`.

The runner refuses any path that resolves outside the root. It refuses before it reads.

### 2.2 Why not the whole workspace

Open product call 6 in `decisions.md` recommends the whole workspace, with the approval manifest
as the control. The gate review rejects that, and this contract follows the review.

The reason is that a manifest is a poor control against a secret. The workspace holds the
agent's own working files. It holds `AGENTS.md`, harness configuration files, and whatever the
agent wrote during the run. A prompt-injected agent can point `value_from` at any of them. The
human then sees a manifest of file names and sizes. A human approving a skill does not read a
manifest as a security boundary. They see a plausible list and they approve.

A designated root moves the control earlier. The agent must first place content in `.agenta-imports/`.
That placement is an ordinary file write, which the run's own permission policy already
governs. The import boundary then only has to enforce one thing: stay inside the root.

### 2.3 Root behavior

- The runner creates `.agenta-imports/` during workspace preparation. It creates it empty.
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

- any `..` segment, tested on the RAW segments (normalizing first would collapse
  `a/../../b` into an escape that no longer looks like one);
- a backslash separator;
- a NUL byte;
- a path longer than 1024 bytes;
- an absolute path that resolves OUTSIDE the workspace.

An absolute path inside the workspace is normalized, not refused. `change-set.md` section
6.3 is authoritative for the accepted path forms: relative to the import root, relative to
the workspace root, or absolute inside the workspace. An earlier version of this list
refused every absolute path; that predates the ruling, which is that agents write absolute
paths naturally and refusing them fights the model for nothing.

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

Concretely, the runner walks to `.agenta-imports/pdf-tools/scripts/` and lists `extract.py`. It then
opens the path `.agenta-imports/pdf-tools/scripts/extract.py` with `O_NOFOLLOW`. An attacker replaces
`scripts` with a symbolic link to `/home/user/.ssh` in between. The open resolves through the
link, reaches `/home/user/.ssh/extract.py`, and succeeds. The final component was not a link, so
the flag stays silent.

The fix is a real file-descriptor-relative walk. The runner never rebuilds a full path string
and never re-resolves from the root.

1. Open the import root once. Verify it with `fstat` on the handle.
2. For each directory level, open the child **relative to the parent's descriptor**, with the
   no-follow and directory flags set. In Node this is
   `fs.open("/proc/self/fd/<parentFd>/<name>", ...)`, one component at a time. See the note
   below.
3. Open each file relative to its parent directory's descriptor, with `O_NOFOLLOW`.
4. `fstat` every handle. Read the type, the size, and the mode from the handle, never from a
   path.
5. Read the content from the same handle.
6. Close each handle when its level completes.

This removes the class. A descriptor names an inode, not a path. Replacing a directory in the
tree after the runner holds its descriptor does not move the descriptor. The attacker can only
change what a **new** path lookup would find, and the runner performs none.

**How it is built, and it needs no native helper.** Node's public API exposes no `openat`,
and `fs.promises.opendir` returns a `Dir` with no usable descriptor for relative opens. An
earlier version of this section concluded that the walk therefore needed a narrow native
helper or a documented fallback, and asked the plan to budget it. That was wrong, and the
budget line is withdrawn.

`/proc/self/fd/<fd>` names the directory the descriptor points at. So opening
`/proc/self/fd/<parentFd>/<name>` resolves `<name>` against the INODE the runner already
holds, not against a path that may have been replaced since. Walking one component at a
time through that, with `O_NOFOLLOW` on each open, gives exactly the property this section
requires, in plain Node:

```ts
fs.open(`/proc/self/fd/${parent.fd}/${name}`, O_RDONLY | O_NOFOLLOW)
```

Two conditions come with it, and both hold here. The component must be a single name, never
a multi-component path, or the lookup an attacker can redirect comes back. And `/proc` must
be mounted, which makes this Linux-only — fine, because the runner runs in Docker and in
Daytona, both Linux.

Implemented in `services/runner/src/tools/workspace-reader.ts` and verified the honest way:
a probe ran the rejected path-based alternative against the same fixture and read a file
from OUTSIDE the import root through a swapped intermediate directory, exactly as this
section predicts, while the descriptor walk refuses it.

One error-reporting note. With `O_DIRECTORY` and `O_NOFOLLOW` together, Linux reports a
symbolic link as `ENOTDIR` on some kernels and `ELOOP` on others. Both refuse the component,
so the security property is identical; the reader re-opens once without `O_DIRECTORY`,
still relative to the same descriptor, purely to tell "symbolic link" from "not a
directory" in the message.

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

### 3.4 The descriptor walk is required for v1

**Decided in answer to gate 3, finding 3.** The descriptor-relative walk in section 3.2 is
REQUIRED. The path-based fallback is a rejected alternative.

**Built and landed, at no extra cost.** The `/proc/self/fd` technique in section 3.2 gives
the required property in plain Node, so the walk needed no native helper and the plan needs
no budget line for one. The rest of this section stands: the fallback is still rejected, and
the conditions below still apply if anyone reverses that.

The gate 1 and gate 2 versions of this section left the choice open, "if the plan decides the
native helper is not worth its cost". Gate 3 is right that this is not a choice a plan can defer:
the two options have different threat models, and the rest of this contract is written for the
stronger one. Leaving it open meant no reader could tell which contract they were implementing.

**The rejected alternative, recorded.** A path-based walk with `O_NOFOLLOW` is cheaper. It needs
no native helper. It is rejected because it does not defend against a replaced intermediate
directory, which section 3.2 shows is the attack that matters. Its only remaining backstop would
be a human reading the approval card, and a human reading a card is not a technical control.

If a later decision reverses this, three things must change together, and none of them may be
skipped:

1. This section, section 3.2, and section 3.3 must all say that the local path defends against
   the confused agent and not against an adversarial process.
2. The intermediate-directory test in section 10 becomes a recorded known failure. It is never
   deleted and never marked passing.
3. `plan.md` must record the accepted risk, in the same place it records the accepted Daytona
   risk from section 6.5.

Until that reversal happens, treat the fallback as out of scope.

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

Three independent yes answers must line up before a bundled file ever becomes executable, and
they do NOT all act at the same time. Gate 3 is right that the gate 2 wording blurred this.

| Answer | When it acts | Owner |
|---|---|---|
| `on_executable: "import"` | At IMPORT time, once. It decides whether the bits may be read and carried at all. It is never consulted again. | The caller, plus the human approver |
| The stored `allow_executable_files` | At RUN time, on every materialization | The stored configuration |
| The materializer's `execPolicy` | At RUN time, on every materialization | The platform |

`on_executable` is an ephemeral import grant. It is not a runtime permission, and it is never
persisted. Saying it is "checked at run time" would imply the import grant survives into the
revision, which is exactly the conflation the four-layer split exists to remove.

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

**`-maxdepth 8` alone is not safe, and the gate 1 text missed this.** `find` with `-maxdepth 8`
does not report an entry below depth 8. It does not warn either. So a file at depth 9 simply is
not in the manifest, and the import commits a skill that silently lacks it. Section 4.2 says a
too-deep entry is unsupported and must reject or appear as an omission. A silent disappearance
is neither.

So the runner runs a **depth-overflow probe** beside the manifest command:

```
find <absRoot> -mindepth 9 -printf 'x' -quit
```

`-quit` stops at the first match, so the probe costs one entry, not a full walk. Any output at
all means the tree goes deeper than the walk. The runner then treats the whole source as
carrying too-deep entries and applies `on_unsupported`:

- under `reject`, the import fails with `source_unsupported_content` and names the depth limit;
- under `omit`, the import proceeds and the manifest records one omission entry with reason
  `too_deep`.

The probe reports existence, not the paths. That is deliberate. Listing every too-deep path
could be unbounded, and the user only needs to know that the tree exceeds the limit. When the
user needs the paths, they run their own `find`.

The local reader has the same obligation. Its descriptor walk stops at depth 8, so it must
record that it stopped rather than return quietly. Section 4.2's rule is the same on both
readers.

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

1. **The import root.** An attacker must first place or modify content under `.agenta-imports/`. The
   run's own permission policy governs that write. This is the primary control, and it holds
   against the confused agent.
2. **The human on the approval card.** The card shows the bytes the runner actually read. A
   substitution changes what the human sees before they approve it.
3. **`contentDigest`.** What the human approved is what the API receives. A later change on disk
   cannot alter the committed value.

None of the three stops a well-timed swap by a process that already runs arbitrary code inside
the sandbox. Against that attacker, on Daytona, this contract does not claim protection.

That is an honest position, and it is defensible: an attacker who already runs arbitrary code in
the sandbox can also write whatever it wants directly into `.agenta-imports/` and let the import read it
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
- Object keys are sorted by the serializer.
- **The serializer is `strictCanonicalJson`**, defined in `execution-authorization.md` section
  2.3.3. It is NOT `canonicalJson` from `services/runner/src/responder.ts`.

The gate 1 version of this section named `canonicalJson`. That was wrong, and it contradicted
the authorization contract. `canonicalJson` calls `normalizeJsonish`, which parses any string
that looks like a JSON object or array and replaces the string with the parsed value. A skill
body is a string. A file's content is a string. Either can look like JSON. So the lenient
serializer would give two different skill values the same `contentDigest`.

`contentDigest` and `argsDigest` must sit on the same side of the serializer boundary. The
authorization verifies both at consume time (`execution-authorization.md` section 3.2), so a
lenient `contentDigest` would reopen the exact substitution hole the strict `argsDigest` closes.
One rule, stated once: **every digest that authorizes an execution uses the strict serializer.**

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
  onExecutable,              // "reject" | "import" -- the import grant (layer 2)
  persistExecutableCapability, // boolean -- the stored capability (layer 3)
  executableFiles: [path],   // the observed bits (layer 1)
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
4. The executable section, when `executableFiles` is non-empty. It shows the two grants on two
   separate lines, per section 5.2.
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
  baseRevisionId,            // the operation's base_revision_id. Always present.
  oldBytes,
  oldLines,
  oldDigest,                 // the digest of the old text AS FETCHED FROM baseRevisionId
  diff,
  addedLines,
  removedLines,
  contentDigest,             // equals newDigest in this mode
  catalogGeneration
}
```

There is no `itemName`, no `files`, no `omitted`, and no executable section. A `set` writes one
string. None of those concepts applies.

There is also no `oldAvailable` flag any more. Section 8.4.3 explains why it is gone.

#### 8.4.2 What the card shows, with old text available

1. The target field, by its readable name. "Replace the instructions" or "Replace the body of
   skill `pdf-tools`".
2. The source path.
3. A **unified diff** of the old text against the new text.
4. The changed-line counts, as added and removed.
5. The old and new sizes, in bytes and lines.
6. `contentDigest`.

The diff is the substance of the card. Items 4 to 6 support it. They never replace it.

**The old side comes from the exact `base_revision_id` the operation carries. It never comes
from the configuration running in the session.**

Gate 3, finding 2 found the hole in the gate 2 wording, and it is a real one. The session may be
running revision N. The model may correctly supply head revision N+1 as `base_revision_id`,
because it read the head with `read_config`. If the card diffs against the session's revision N,
the human approves an N-to-new change. The base check then passes, because the base really is
N+1, and the commit replaces N+1 with text the human never compared against it. Nothing fails,
and the wrong thing commits.

So the runner fetches the old text at `base_revision_id`, by the operation's own target path.
The card renders that text as the old side, and the manifest records `baseRevisionId` and
`oldDigest` beside it. Approval then means one thing: this exact old text becomes this exact new
text, on this exact base.

The base check in `commit-transaction.md` section 6 still runs. It catches a head that moves
between the approval and the commit. It does not substitute for fetching the correct old side,
because it compares revision identifiers and never compares the text the human read.

#### 8.4.3 When the old text cannot be fetched: fail closed

**Decided in answer to gate 3, arbitration ruling 1.** If the runner cannot obtain the old text
at `base_revision_id`, the operation FAILS. The runner does not show a card, does not mint an
authorization, and does not commit.

The error is `source_base_unavailable`. It is retryable, because a transient fetch failure is
the common cause.

This replaces the gate 2 rule, which showed the complete new text and said no old text was
available. That rule was wrong for this mode. A `set` REPLACES a field that already holds a
string; `change-set.md` section 5.1.1 requires the target to exist and to hold a string, so an
old text always exists somewhere. "Unavailable" therefore never means "there is none". It means
the runner failed to fetch it. Presenting a fetch failure as a complete-content approval invites
the human to approve a replacement without seeing what it replaces, which is the one thing this
mode exists to prevent.

The complete-new-text presentation still applies in the ITEM mode, where a genuinely new skill
body has no predecessor. See section 8.2. It has no place here.

The rule stated once, for both modes: **the card never shows only a byte count and a path, and
the single-text mode never shows a new text without the old text it replaces.**

#### 8.4.4 Truncation rules, single-text mode

| Element | Rule |
|---|---|
| Diff, old text available | Capped at 400 lines, matching the item mode's replace rule. Beyond that, show the first 400 diff lines, then the changed-line counts and both digests. |
| New text | Shown only inside the diff. There is no no-old-text presentation in this mode. See section 8.4.3. |
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
| `source_base_unavailable` | The old text could not be fetched at `base_revision_id`. Single-text mode only. Retryable. |

Every code carries the offending paths, up to 20, and a count of the rest.

## 10. Test obligations

**Confinement.**
- Traversal, absolute path, backslash, and NUL are refused before any read.
- A symbolic link at the folder root is refused.
- A symbolic link inside the folder is refused, even when its target stays inside the workspace.
- A path outside `.agenta-imports/` but inside the workspace is refused.
- A valid folder BELOW `.agenta-imports/` is accepted. This is the descendant test in section 6.2, and
  the gate 1 equality test would have failed it. Add it as a regression guard.
- `.agenta-imports/` itself is refused, per section 2.3.

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

**Depth overflow.**
- A file at depth 9 is DETECTED, not silently omitted. Under `reject` the import fails with
  `source_unsupported_content`. Under `omit` the manifest carries one `too_deep` omission.
- The local descriptor walk reports the same condition at the same depth.
- The probe costs one entry, not a full walk. Assert the command shape, not only the outcome.

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
- The card renders a unified diff plus changed-line counts.
- The old side is fetched from `base_revision_id`, NOT from the session's configuration. Run the
  session at revision N, supply N+1 as the base, and assert the diff's old side equals the text
  at N+1. This is gate 3 finding 2 and it must have its own test.
- A failure to fetch the old text produces `source_base_unavailable`. No card is shown and no
  authorization is minted.
- The card never renders only a byte count and a path.
- A diff longer than 400 lines truncates the DIFF and still states that the digest covers the
  full text.
- `oldDigest` in the manifest matches the text actually fetched from the base.
- A target that does not exist is `target_not_found`. A non-string target is
  `target_type_mismatch`. Neither reads any content.

**Digest.**
- `contentDigest` uses `strictCanonicalJson`, not `canonicalJson`. A skill body holding the text
  `{"x":1}` must NOT digest the same as a skill body holding the object. This is gate 3 finding
  3 and it guards the serializer boundary from the import side.
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
| `decisions.md` open call 6 | The reach is the designated `.agenta-imports/` root, not the whole workspace. |
| `spikes/runner-spike.md`, "Codec gaps" | `allow_executable_files` is no longer derived. Binary and oversized files no longer drop silently. Symbolic links are no longer followed. |
| `plan.md` | Add the `.agenta-imports/` root creation to the workspace slice. Add the Daytona reader as its own unit of work. |

## 13. Gate 2 resolution

| Gate 2 point | Where it is answered |
|---|---|
| New problem 3: local `O_NOFOLLOW` does not protect a replaced intermediate directory | §3.2 retracts the gate 1 claim, shows the concrete attack, and specifies a descriptor-relative walk. §3.3 names the two attackers. §3.4 defines the honest fallback if the native helper is not built. §10 adds the intermediate-directory test, including its known-failure form. |
| New problem 4: Daytona root check is equality, and the two-pass manifest is still raceable | §6.2 replaces equality with a descendant test and explains why the gate 1 text would have rejected every valid import. §6.3 states what the manifest does not establish. §6.5 retracts the two-pass bound, walks the same-size swap attack step by step, demotes the passes to a consistency check, and states what actually bounds the path. §10 adds a test that ASSERTS the weakness. |
| New problem 10: `allow_executable_files` conflates import grant and persisted capability | **Decided 4 August.** §5.2 splits the concern into four layers with one owner each: `on_executable` is the import grant, `persist_executable_capability` is the persisted capability, and the second requires the first. Violation is refused before any workspace read. The card shows two separate lines. §5.3 and §5.4 follow. §5.5 keeps both fields off the file source. §11 widens the folder schema. §10 replaces the executable tests. The conservative alternative is recorded as rejected, with its reason. |
| New problem 9: the approval manifest cannot describe every allowed operation | **Resolved jointly.** `change-set.md` §5.1.1 allows `value_from` on `set` under three conditions and §5.1.3 splits the source schema. This contract owns condition 3. §8.0 defines the two presentation modes and the rule they share: the card never shows only a byte count and a path. §8.4 defines the single-text mode, including the diff, the counts, the digests, and the no-old-text case that shows the COMPLETE new text and says why. §5.5 records the source-schema split. §10 adds ten single-text tests. |
| Item 5 status: default policy, limits, manifest, Daytona framing | Unchanged from gate 1. §2, §4, §6.2, §6.6, §7, §8.1 to §8.3. |

Not resolved here, by design:

- Gate 2 item 7, the slice plan, belongs to `plan.md`. §2.3 and §6 each name work the plan
  must budget. §3.2's native-helper budget is withdrawn: the `/proc/self/fd` walk needs no
  helper and is already built.

## 14. Gate 3 resolution

| Gate 3 finding | Where it is answered |
|---|---|
| Finding 3a: `contentDigest` still named the lenient `canonicalJson`, contradicting the authorization contract | §7.2 now names `strictCanonicalJson` from `execution-authorization.md` §2.3.3, explains that a skill body or a file's content is a string that can look like JSON, and states the boundary once: every digest that authorizes an execution uses the strict serializer. §10 adds a test asserting the two digests differ. |
| Finding 3b: the item manifest still carried the obsolete single `allowExecutableFiles` | §8.1 replaces it with `onExecutable` and `persistExecutableCapability`, labelled by layer, with `executableFiles` kept as the observed bits. §8.2 item 4 now shows two lines, per §5.2. |
| Finding 3c: `find -maxdepth 8` silently omits deeper entries | §6.2 adds a depth-overflow probe, `find -mindepth 9 -printf 'x' -quit`, which costs one entry rather than a full walk. Overflow applies `on_unsupported`: reject fails loudly, omit records one `too_deep` omission. The local descriptor walk carries the same obligation. §10 adds three depth tests. |
| Finding 3d: the local reader left the native-helper versus fallback choice to a plan that chose neither | §3.4 is rewritten. The descriptor-relative walk is REQUIRED for v1. The path-based fallback is a recorded rejected alternative, with the three things that would have to change together if the decision is ever reversed. |
| Finding 2 / arbitration ruling 1: the single-text diff compared against the session's configuration, so a correct `base_revision_id` of N+1 could commit against text the human never saw | §8.4.2 now fetches the old side from the exact `base_revision_id`, never from the session, and works the N versus N+1 case through. §8.4.1 adds `baseRevisionId` and `oldDigest` to the manifest and drops `oldAvailable`. §8.4.3 replaces the complete-new-text presentation with a fail-closed `source_base_unavailable`, because a `set` always replaces an existing string, so "unavailable" means a fetch failure and never "there is none". §9 adds the code. §10 adds a dedicated N/N+1 test. |
| Arbitration ruling 2: `on_executable` was wrongly described as an at-runtime permission | §5.4 replaces the three-yes-answers sentence with a table separating what acts at import time from what acts at run time, and states that the import grant is ephemeral and never persisted. |

One product call this contract cannot make:

- Gate 3 arbitration ruling 2 asks whether setting the persisted capability must always force
  approval, independently of the generic commit permission. This contract does not decide it.
  The conservative reading is yes: `persist_executable_capability: true` grants a durable
  runtime capability, which is a different question from whether the agent may commit at all.
  It needs an owner's answer before S3c.

Not resolved here, by design:

- The accepted Daytona race risk from §6.5 must be recorded in `plan.md`. Gate 3 finding 4's
  ruling notes it is still missing there. This contract states the risk; the plan must accept it
  in writing.
- `decisions.md` still names `allow_executable_files` on `value_from` in its contract-phase
  paragraph. That is the pre-split name. §5.2 and §11 carry the current one.
