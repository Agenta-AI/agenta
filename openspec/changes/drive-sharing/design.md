# Design: drive sharing with one kind of drive

Every "today" statement points to code at the heads of the open pull requests: API, SDK and runner at commit `81804cc34d` (the head of the runner pull request #8316, which contains the API and SDK work of #8315), and web at commit `33f0ee01b2` (the head of #8319). Paths are relative to the repository root.

Each statement carries one of three marks:

- **Measured**: read in the code, with a citation.
- **Decided**: a product decision (listed below).
- **Proposed**: a choice of this design, open to review.

## Words used in this design

- **Drive**: a folder of files that the platform keeps in an object store between conversations. In the API and the runner a drive is a **mount**: a row of the `mounts` table plus a key prefix in the store. The configuration and user-facing text say "drive"; the API and runner code say "mount" (see "Names per layer").
- **Object store**: a storage service that keeps each file as one object under a key (Amazon S3, SeaweedFS).
- **Mount** (the act): make a drive appear as a normal folder, so that normal file tools (`cat`, an editor) work on it. The runner uses **geesefs**, a program that serves an object store prefix as a folder through **FUSE** (a Linux feature that lets a normal program serve a folder).
- **Runner**: the Node.js service in `services/runner` that runs one agent turn. For a Python developer: it plays the role of a worker process in a job queue. The Python **agent service** decides what to run and sends the runner a run request; the runner runs it.
- **Sandbox**: the machine where the agent's shell commands run. There are three kinds (the code says "sandbox provider"): `local` (the runner's own machine), `daytona` (a cloud machine per conversation) and `inprocess` (the agent program runs inside the runner; only its shell commands go to a cloud machine) (`services/runner/src/config/runner-config.ts:20`).
- **Harness**: the coding agent program that the runner drives, for example Pi, Claude Code or Codex.
- **Working folder**: the folder where the agent's commands run during one conversation. With a session drive, it is that drive.
- **Session drive**: the drive that holds the working folder of one conversation.
- **Home drive**: the one attached drive that the configuration names in `home_drive`. The platform keeps the agent's saved tools, app files, template files and README there, and links it at `agent-files/`.
- **Link**: a symbolic link, a file system entry that points to another path.
- **Visibility**: who may open an agent or a drive. Shared (stored as `project`) means every project member whose role allows the action. Private (stored as `private`) means only the owner.
- **Access**: what a run may do with an attached drive: `read-write` or `read`. This design never uses "access" for visibility.
- **Principal**: who a request or a run acts for: a person, an API key, or a channel installation (a chat channel binding).
- **Revision**: one saved version of an agent configuration.

## Product decisions this design builds on (Decided)

1. There is one kind of drive. The agent's own drive is an ordinary drive. A drive belongs to the project, has a slug, and has its own visibility (who may open it).
2. The unified design replaces the two-kind design (entries `{ "kind": "agent" }` and `{ "kind": "project", ... }`) before any of the open pull requests merges.
3. The configuration lists drives as `{ "slug", "access" }` entries. An optional pointer `home_drive` names the one attached drive that holds the agent's saved tools (`.tools/`), app files (`.apps/`), template files and README.
4. Every attached drive appears in the working folder at `drives/<slug>/` (like `/mnt` on Linux). `agent-files` is a link to the home drive (like a home folder), for old and new agents. An agent with no home drive has no `agent-files/`. The platform writes `drives/README.md` at every start, from the configuration, for the agent and the person.
5. A drive is shared or private, the same two states agents have. A shared agent can attach only shared drives. A personal agent can attach shared drives and its owner's private drives. When a personal agent becomes shared, its drives must become shared.
6. When a personal agent becomes shared, the same action makes its private drives shared, and the response lists them. (Rejected option: refuse the change until the drives are shared by hand.)
7. A drive is created when an agent is created (new agent or copy). A new agent gets one drive of its own by default: created with the agent, named after the agent, with the agent's visibility, listed in the configuration and set as home. A template or a person can remove it. (Rejected option: no drive by default.)
8. The migration gives every existing agent drive a slug, lists it in the stored configuration and sets it as home, so nothing changes for existing agents and their users.
9. `has_session_drive` stays a boolean. The session folder is the working folder and is not a drive entry.
10. Read-only access is enforced by the storage credentials and by the mount. A save that names a missing drive is refused (a drive is created first, then attached). An agent cannot change its own drives with its commit tool. The app shows drives in the session files pane; other screens are out of scope. Two releases: release 1 reads a configuration without the keys as today's behavior; release 2 rewrites stored configurations in place.

## Context: how it works today

### Production today, and what the open pull requests added (Measured)

In production an agent run gets two drives by fixed rules. The session drive comes from the conversation id, and the agent's own drive comes from the agent's id. No configuration field names either one. The open pull requests added a `drives` list with two kinds of entries, `{ "kind": "agent" }` and `{ "kind": "project", "slug": ..., "access": ... }` (`sdks/python/agenta/sdk/agents/dtos.py:407-436`), and the default template writes `"drives": [{"kind": "agent"}]` for every new agent (`sdks/python/agenta/sdk/utils/types.py:1583-1584`). None of this is merged.

| Folder | What the agent sees | How it is found | Who may open it |
|---|---|---|---|
| Session drive | its working folder | by the conversation id | whoever may open the conversation |
| The agent's own drive | `agent-files/` | by the agent's id; created at the first run | whoever may open the agent |
| Project drive (open pull requests only) | `drives/<slug>/` | by a slug in the configuration | every project member with the permission |

### The drive row in the API (Measured)

- A drive is a row of `mounts`. The key is `(project_id, id)` and a unique constraint holds `(project_id, slug)` (`api/oss/src/dbs/postgres/mounts/dbes.py:13-27`). The row has bare `session_id` and `agent_id` columns, with no foreign key (`api/oss/src/dbs/postgres/mounts/dbas.py:29-45`), and an index on `(project_id, agent_id)` that is not unique (`dbes.py:44-49`).
- The files live under `mounts/<organization_id>/<mount_id>` (`api/oss/src/core/mounts/types.py:30-39`). The prefix is written once at insert and does not depend on the slug (`api/oss/src/dbs/postgres/mounts/dao.py:114-127`). **A slug can change without moving any file.**
- The agent's own drive has the reserved slug `__ag__agent__<artifact id>__default` and stores `agent_id` (`api/oss/src/core/mounts/service.py:137-157`, `service.py:604-630`). `get_or_create_agent_mount` is an upsert keyed on the slug (`dao.py:129-144`). The sign route `POST /mounts/agents/sign` calls it, so the first run creates the drive (`api/oss/src/apis/fastapi/mounts/router.py:484-510`). An agent that never ran has no drive row.
- A project drive is a row with no session and no agent. `POST /mounts/` creates it; a caller may not use the reserved prefix `__ag__` (`service.py:179-182`, `service.py:503-516`). `fetch_project_mount` refuses a reserved slug and a row with `agent_id` (`service.py:962-979`). `POST /mounts/projects/sign?slug=&access=` signs it, read-only for `access=read` (`router.py:512-540`).
- Credentials: the API asks the store for a key pair limited by an inline policy to one prefix; `read_only` signs credentials that can read and list but not write (`service.py:1149-1188`).

### The visibility rules today (Measured)

- An agent is `private` or `project`. Table `agent_access`, key `(project_id, artifact_id)`, columns `visibility` and `owner_user_id`; no row means project-visible with no owner (`api/oss/src/dbs/postgres/sharing/dbes.py:17-52`).
- Rule A1: no row, or `project`: only the role decides. Rule A2: `private`: only the human owner, or the owner's channel binding when the action is `RUN_WORKFLOWS` on its own channel turn (`api/oss/src/core/sharing/service.py:173-206`).
- `allow_mount` checks a drive by its scope: a session drive follows its session, a drive with `agent_id` follows its agent (A1, A2), and a project drive is open to every member with the permission (`api/oss/src/apis/fastapi/sharing/utils.py:468-499`).
- `POST /mounts/agents/sign` checks `USE_MOUNTS` on the agent (`router.py:492-497`). `POST /mounts/projects/sign` (open pull request) checks only the role (`router.py:523`). `POST /mounts/` takes a caller-supplied `agent_id` (`router.py:424-436`).
- **A channel turn of a private agent gets no agent drive.** The A2 exception covers only `RUN_WORKFLOWS` (`service.py:196-205`), and the sign route asks for `USE_MOUNTS` (`router.py:492-497`). So the sign answers not found and the runner logs `mount degraded kind=agent_mount` and runs without the drive (`services/runner/src/engines/sandbox_agent/environment-setup.ts:151-155`). This comes from reading the code; no test covers it.
- An API key never passes A2 (`service.py:1129-1136`). A private agent's conversation can be shared with a Participant, but he cannot send a turn, and he sees nothing of the agent drive (`router.py:550-556`).
- Only the active human owner changes an agent's visibility; the change writes only the `agent_access` row (`api/oss/src/core/sharing/service.py:568-592`, `815-866`). `SharingService` never reads revisions (`service.py:122-127`); the sharing router has the workflows service and reads the head revision for its disclosure (`api/oss/src/apis/fastapi/sharing/router.py:451-461`).

### Where an agent is created (Measured)

All paths run in the API process. No worker creates agents, and no route copies an agent into a new artifact.

| Path | Function | What it creates |
|---|---|---|
| Workflow create | `WorkflowsService.create_workflow` (`api/oss/src/core/workflows/service.py:1680`) | artifact; `agent_access` row when it is an agent with an owner |
| Simple workflow create | `create_simple_workflow` (`api/oss/src/apis/fastapi/workflows/router.py:2655`) | artifact, variant, first revision |
| First agent revision | `commit_workflow_revision` (`service.py:3291`) then `_ensure_first_agent_access` (`service.py:3374`, `3395-3418`) | revision; a project-visible `agent_access` row owned by the request's person when none exists |
| Application create, simple application create | `api/oss/src/apis/fastapi/applications/router.py` (`create_application`, simple create) | artifact, revision through the same commit |
| Variant fork | `fork_workflow_variant` (`service.py:2201`) | a new variant in the same artifact: same agent, same drive |
| Agent template load | `AgentTemplateLoader.load` (`api/oss/src/core/agent_templates/loader.py:436-500`) | artifact, revision, a session; then writes the template's files into the agent drive (`loader.py:495`, `api/oss/src/core/mounts/service.py:677-798`) |
| Static catalog agents | reserved `__ag__*` ids resolved in code (`api/oss/src/core/workflows/static_catalog.py:522`) | nothing in the database; their drive is per project |

Every path that stores a revision passes through `commit_workflow_revision`, which already runs the drive save check (`service.py:3328-3331`, `service.py:535-554`).

### How the folders are laid out today (Measured)

The layout is the same on the three sandbox kinds; only the machine that mounts differs.

```
<root>/mounts/<organization>/
  <session>/                          the working folder (session drive)
    AGENTS.md, .claude/, .codex/      written by the platform at every start
    attachments/                      files the user sent in the chat
    agent-files -> <session>-agent    a link
    drives/notes -> <session>-project-notes   a link per project drive (open pull requests)
  <session>-agent/                    the agent's own drive, mounted beside
  <session>-project-notes/            each project drive, mounted beside
```

| Sandbox kind | Who mounts | When | Root |
|---|---|---|---|
| `local` | the runner's machine | before the agent program starts | `/var/lib/agenta` |
| `daytona` | the cloud machine | while the runner sets the machine up | `/home/sandbox/agenta` |
| `inprocess` | the cloud machine for shell commands | at the first tool call after each start of that machine | `/home/sandbox/agenta` |

Evidence: roots `services/runner/src/engines/sandbox_agent/run-plan.ts:440-457`; agent drive path `agent-mount.ts:37-39`; project drive path `project-mount.ts:30-32`; local mounts before the harness starts `services/runner/src/environment/mount-lifecycle.ts:27-38`; daytona mounts during setup `engines/sandbox_agent/environment.ts:1314-1444`; inprocess mounts at the first tool call `engines/inprocess/sandbox/sandbox-drive.ts:13`, `297`, `326-338`.

**Why the drives sit beside the working folder and are linked into it** (Measured). The reason is in decision D3 of the original agent drive design, which the runner code still names (`agent-mount.ts:1-4`) but which is no longer in the tree. It rejected two other placements: a fixed path per agent collides when two conversations of one agent run at the same time on `local`, where one mount namespace holds every session (`run-plan.ts:443-445`); and a folder inside the working folder puts one FUSE mount inside another, which nobody has measured with geesefs. The link exists so that the agent finds the drive when it lists its working folder, the first thing every harness does. The cost: geesefs turns a link into an empty file after a remount (`durable-symlink.ts:1-13`), so the runner repairs links every turn. On `daytona` the `agent-files` link is made once at setup (`environment.ts:1351-1366`) and is not repaired per turn, because the repair is gated on the runner's own machine (`run-turn.ts:1464`); project links are repaired on both (`run-turn.ts:1474-1479`).

**The link rules differ by kind today** (Measured). A real `agent-files` folder is emptied into the agent drive (`agent-mount.ts:219-249`). A real `drives/<slug>` folder, or a file with content, is never replaced (`project-mount.ts:60-108`), and leftover project links are pruned (`project-mount.ts:161-193`, `environment.ts:836-838`, `environment.ts:1442-1444`).

### What the agent's own drive is used for (Measured)

| Use | What it does | Evidence |
|---|---|---|
| Memory | The platform text tells every agent to keep durable files in `agent-files/` | `sdks/python/agenta/sdk/agents/platform_instructions.py:170-193` |
| Saved tools | The runner copies `agent-files/.tools/bin/` into each new conversation and runs `.tools/setup.sh` under the `allow` posture | `services/runner/src/engines/sandbox_agent/agent-tools-setup.ts:1-43`; cache keyed by project and agent id, `agent-tools-cache.ts:61-74` |
| Apps | Starters, layout and registry in `agent-files/.apps/`; `list_starters` finds the drive by the agent id and creates it if absent | `api/oss/src/core/apps/service.py:36-39`; `api/oss/src/core/apps/handlers.py:220-230` |
| Template files | Written into the agent drive found by the workflow id when an agent is created from a template | `api/oss/src/core/agent_templates/loader.py:495`; `api/oss/src/core/mounts/service.py:677-798` |
| README | Written into the drive if absent; not found on `inprocess` | `agent-mount.ts:22-31` |
| `AGENTA_AGENT_MOUNT_DIR` | Set on `local` only; nothing reads it | `mount-lifecycle.ts:194-201` |
| Prompt paragraph | "Your durable agent folder, `agent-files/` ..." | `engines/sandbox_agent/agent-mount-guidance.ts:39-106`; `platform-guidance.ts:83-102`, `172-182` |
| Agent page card | Lists the 5 newest files of the drive found by the agent id; "This agent has no drive yet." | `web/mobile/src/features/agents/AgentDriveCard.tsx:41`, `73` |
| Files pane | Folds the drive under `agent-files/`; maps tool paths under `<session>-agent` | `web/packages/agenta-entities/src/drive/useSessionDrive.ts:40-78`; `web/packages/agenta-entities/src/session/core/fileActivity.ts:108-109`, `175` |

Most uses need to know **which drive is this agent's**, and today they answer with the agent's id. Only the prompt texts and the web fold need the name `agent-files`. None needs a different kind of storage.

### What the session folder holds (Measured)

The instructions file, the harness settings and skills (rewritten at every start, `engines/sandbox_agent/workspace.ts:56-162`), the Codex and Pi conversation history, attachments and apps built with the app tool. On `inprocess` the runner needs the session drive to pass skills and attachments to the cloud machine, so a run without one is refused with `session_drive_required` (`environment-setup.ts:97-108`). This change does not touch it.

## Goals / Non-Goals

Goals:

- One kind of drive, with its own visibility, that covers: a support agent with no memory, a crew that writes one folder, today's agent with its own folder, and a drive that exists before any conversation.
- Existing agents keep their files at `agent-files/`, with the same text in their instructions and templates, at every step of the rollout.
- A private drive never reaches a principal that may not use it, whatever a configuration says.
- One runner code path for every drive on every sandbox kind.

Non-goals:

- Screens to create, attach, browse or share drives, except the session files pane and the agent page card.
- Drives shared with named people, drives across projects, artifacts (favorites that point into drives).
- A route to change a drive's visibility directly. A drive changes visibility only through its agent (Decision 4).
- The session folder as a backup of the cloud machine's disk. `has_session_drive` stays as it is.
- Locks, merges, quotas, file history screens.

## Decisions

### Decision 1: the model and the configuration shape

Before (open pull requests):

```json
{
  "has_session_drive": true,
  "drives": [
    { "kind": "agent" },
    { "kind": "project", "slug": "price-lists", "access": "read" }
  ]
}
```

After (Decided shape):

```json
{
  "has_session_drive": true,
  "drives": [
    { "slug": "quote-agent-files" },
    { "slug": "price-lists", "access": "read" }
  ],
  "home_drive": "quote-agent-files"
}
```

The cases from the goals:

```json
// support agent: reads knowledge, keeps nothing
{ "has_session_drive": true,
  "drives": [ { "slug": "support-playbook", "access": "read" } ],
  "home_drive": null }

// a crew of three agents: all three have this
{ "has_session_drive": true,
  "drives": [ { "slug": "crew-notes" } ], "home_drive": "crew-notes" }

// an agent created before this change, after the migration
{ "has_session_drive": true,
  "drives": [ { "slug": "quote-agent-files" } ], "home_drive": "quote-agent-files" }
```

| Field | What it is | Who sets it | When it changes | Role |
|---|---|---|---|---|
| `drives` | the drives this agent attaches | the API at creation; a person, or a tool that edits other agents' configurations | per revision | definition of the agent's resources, beside `tools`, `mcps`, `skills` |
| `drives[].slug` | which drive; the drive's unique name in the project | same | per revision | reference |
| `drives[].access` | `"read-write"` (default) or `"read"` | same | per revision | policy: what the run may do |
| `home_drive` | which attached drive holds tools, apps, template files and README; `null` for none | same | per revision, rarely | reference with a role (a pointer into `drives`) |
| `has_session_drive` | whether the working folder persists between turns | same | per revision, rarely | configuration of the workspace (Decided, unchanged) |

What is not on the entry (Proposed): no `kind` (there is one kind), no `path` (every drive appears at `drives/<slug>/`, Decided), no id (the slug is the stable reference inside a project, and it is readable in a configuration). The entry rules, owned by one SDK function `validate_agent_drives` as today (`dtos.py:444-503`):

- `drives` is a list of at most 8 objects; each has a non-empty `slug` that is one path segment (no `/`, `\`, NUL, `.` or `..`, as the runner already requires, `services/runner/src/engines/sandbox_agent/run-drives.ts:48-57`), each slug at most once, and `access` `"read"` or `"read-write"`.
- `home_drive` is absent, `null`, or the slug of an entry with `"read-write"` access. A read-only home cannot hold saved tools or app files.
- An unknown key on an entry, including `kind`, is refused. The two-kind shape never shipped, so no stored data holds it.

`validate_home_drive` is a second small SDK function, called by the same two places (parse and save).

What an absent key means (Proposed, from Decided item 10):

| Configuration | Meaning in release 1 and later |
|---|---|
| no `drives` key | today's behavior: the agent's drive found by the agent's id, at `agent-files/` (the agent service sends no `drives` on the wire) |
| `"drives": []` | no drive at all; no `agent-files/` |
| `drives` without `home_drive` key | no home drive (same as `null`) |

A configuration without `drives` exists only in revisions stored before release 1. The new API fills the keys when it stores or reads such a revision and the agent has a drive row (Decision 5), so the legacy meaning reaches the runner only for an agent without a drive row.

Options for the shape of an entry:

| Option | Trade-off |
|---|---|
| **A. `{ slug, access }` and a separate `home_drive` pointer** | One shape for every entry. The home is a role, not a kind, so a crew can point at one drive. Needs a rule that the pointer names an entry. |
| B. Keep `kind: agent` beside `kind: project` | No migration of slugs. Two code paths in every layer, and an agent drive cannot be shared or named by another agent. Rejected by Decided item 1. |
| C. `{ slug, access, path }` with a free path | Old agents could keep `agent-files` as a path. Every consumer needs path rules; Decided item 4 fixes the paths. |

**Chosen: A** (Decided items 1 and 3).

### Decision 2: the home pointer

With one kind of drive, an agent can have two writable drives, or none. Saved tools, app files, template files and the README need exactly one place.

| Option | Trade-off |
|---|---|
| **A. An optional pointer `home_drive`** | Explicit, one line. Any read-write drive the visibility rule allows can be home (Decision 5); two shared agents can share one. An agent without it has no saved tools and no app files. |
| B. A rule: the first writable drive is home | Nothing to configure, but the order of a list carries meaning, and moving an entry changes behavior without notice. |
| C. No home: look in every writable drive | No setting, but one agent could run a `setup.sh` that another agent put into a shared drive. |

**Chosen: A** (Decided item 3). Every consumer of "the agent's own drive" reads the home drive after this change (Proposed):

| Consumer today | After |
|---|---|
| `.tools/` restore (`agent-tools-setup.ts:1-43`) | from the home drive; cache key is the drive's mount id, not the agent id (`agent-tools-cache.ts:61-74`) |
| README seed (`agent-mount.ts:22-31`) | into the home drive, on all three sandbox kinds (`inprocess` gets it too) |
| Apps tools `list_starters` and `create_app` (`api/oss/src/core/apps/handlers.py:220-230`; today they check only `VIEW_WORKFLOWS` on the agent argument, `api/oss/src/apis/fastapi/tools/router.py:374-388`) | the home drive named in the configuration of the run, after the drive visibility check with the run's principal (Decision 4); a configuration without `drives` uses the legacy lookup by the agent id with the same check. Never creates a drive. |
| Template files (`loader.py:495`) | only into a drive created in the same creation action (Decision 6); never into an existing drive. A seed path that starts with `agent-files/` is written without that prefix (today it would land in `agent-files/agent-files/`, `api/oss/src/core/agent_templates/parser.py:144-167`) |
| `AGENTA_AGENT_MOUNT_DIR` (`mount-lifecycle.ts:194-201`) | removed; nothing reads it |
| Link recovery that moves files (`agent-mount.ts:219-249`) | removed: the runner never moves files into a drive; a real folder at `agent-files` blocks the link and the agent is told |

### Decision 3: the folder structure, and why links stay

After the change (Decided item 4, Proposed paths):

```
<session>/                                   the working folder
  AGENTS.md, attachments/, ...               as today
  drives/
    README.md                                written by the platform at every start
    price-lists -> <session>-drive-price-lists               read-only
    quote-agent-files -> <session>-drive-quote-agent-files
  agent-files -> <session>-drive-quote-agent-files           the home drive
<session>-drive-price-lists/                 one real mount per drive, beside
<session>-drive-quote-agent-files/
```

The home drive is mounted once and linked twice. An agent with no home drive has no `agent-files` link. A configuration without `drives` (release 1, before the migration) mounts the agent's drive found by its id and links it only at `agent-files`, as today.

The mount path changes from `<session>-agent` and `<session>-project-<slug>` to one pattern, `<session>-drive-<slug>` (Proposed). One pattern means one code path and one rule in the web tool-path mapping. The old suffix `-agent` stays readable in the web, because recorded tool paths stay in the database forever (`run-plan.ts:450-452` states the same for an older root).

Layouts considered:

| Option | Trade-off |
|---|---|
| **A. Mount beside, link inside, for all drives** | The mechanism that runs in production today. All mounts run in parallel because none waits for another. The cost is link repair at every turn. |
| B. Mount each drive as a real folder inside the working folder | No links to repair. But `rm -rf *` in the working folder walks into every drive and deletes its files; with links it removes only the link. A recursive delete that walked into mounted drives wiped data once (`run-plan.ts:443-445`). One FUSE mount inside another has never been measured with geesefs, and each drive mount would wait for the working folder mount. |
| C. One folder per run with `work/` and `drives/` side by side | No links and no nesting. But the agent no longer sees its drives when it lists its working folder, chat file links are relative to the working folder (`platform_instructions.py:186-191`), and it is not verified that every harness accepts paths outside its working folder. |

**Chosen: A** (Decided item 4).

The link rules that the open pull requests wrote for project drives apply to every link, `agent-files` included (Proposed):

1. Never replace a real folder, or a file with content, at a link path. The drive is then not available, and the agent is told why.
2. Replace an empty file (what geesefs leaves of a link) or a wrong link.
3. Remove leftover links under `drives/` that the configuration no longer lists, and a leftover `agent-files` link when there is no home drive. Never remove anything else.
4. Repair every link at the start of every turn, on all three sandbox kinds.

### Decision 4: the visibility rule, and where each check runs

**Storage** (Proposed). A new table `mount_visibility`, a sibling of `agent_access`: primary key `(project_id, mount_id)`, columns `visibility` (`private` or `project`) and `owner_user_id`, a foreign key `(project_id, mount_id)` to `mounts` with cascade, a foreign key to `projects` with cascade, the check constraint `ck_mount_visibility_value` (`visibility IN ('private', 'project')`), the check constraint `ck_mount_visibility_private_owner` (a private row has an owner), and the index `ix_mount_visibility_project_id_owner_user_id`. The table is named for what it holds, the visibility. Its sibling `agent_access` keeps its shipped name; it is recorded as an existing naming exception and not renamed here. In this design the word "access" means only read or read-write.

One difference from `agent_access`, on purpose: `owner_user_id` may be null. An ownerless shared drive is a row with `visibility = 'project'` and no owner. Every drive that the API creates or that the migration touches gets a row, so a row is always explicit (Proposed). A missing row exists only in two cases, both before release 2:

- a row with `agent_id` that is not migrated yet: it follows its agent (the legacy branch below);
- a drive that an older API pod created with `POST /mounts/` during the release 1 rollout: it reads as shared, which is what that API meant, and release 2 writes its row.

| Option | Trade-off |
|---|---|
| **A. A `mount_visibility` table like `agent_access`** | Same rules, same code shape, same cache pattern. One more table. |
| B. Columns on `mounts` | No new table. A different shape than agents, so the rule code cannot be shared, and every `mounts` query carries visibility columns. |
| C. A drive follows the agent that created it | No new storage. A drive could not serve several agents of different visibility, and it would change visibility silently with one agent (Decided item 1 gives a drive its own visibility). |

**Chosen: A.**

**The rule** (Proposed, from Decided item 5). Drives use the one entry that agents and sessions use: `SharingService.evaluate(principal, action, project_id, resource, context)`, which dispatches on `resource.kind` (`api/oss/src/core/sharing/service.py:141-171`). The design adds `ResourceKind.MOUNT` (`api/oss/src/core/access/dtos.py:164-166`), a helper `mount_resource(mount_id)` beside `agent_resource` and `session_resource` (`api/oss/src/apis/fastapi/sharing/utils.py:96-101`), and the rule `_evaluate_mount`, which `evaluate` calls for that kind. Today `evaluate` returns None (allow) for a kind it does not know (`service.py:151-171`); for `MOUNT` it must never fall through to allow. HTTP routes reach it through `allow_mount`, which calls `allow_resource` with `mount_resource`; internal callers (apps tools, save check) call `evaluate` with the same resource. There is no second public entry. Its rules, D1 and D2, are built like A1 and A2 (`service.py:173-206`):

- D1: visibility `project`: the role decides (`VIEW_MOUNTS` to read, `EDIT_MOUNTS` to write, `USE_MOUNTS` to sign).
- D2: visibility `private`: only the human owner, with one exception for channel turns (below).
- Legacy branch: a row with `agent_id` and no `mount_visibility` row follows its agent with A1 and A2, as `allow_mount` does today (`api/oss/src/apis/fastapi/sharing/utils.py:493-498`). It keeps a private agent's drive private until release 2 writes its row.
- A session drive keeps its session rules (`utils.py:483-492`).

**What `agent_id` on a drive row means** (Proposed). After this change it means "the agent this drive was created with". Only two readers use it: the legacy sign route for older runners (Decision 11) and the migration. It is not an input to the visibility rule after release 2. `POST /mounts/` refuses a caller-supplied `agent_id` (today it accepts one, `api/oss/src/apis/fastapi/mounts/router.py:424-436`).

**The agent of a run** (Proposed). The channel exception and the home rule need to know which agent a run executes. Today the run credential does not say it: it carries the run envelope (principal, restrictions, authority, run context, sender, approver; `api/oss/src/core/access/principals.py:43-75`) and the `run_accounts` claim (`api/oss/src/middlewares/auth.py:1575-1596`), and nothing names the agent. The run context's `run_id` comes from the caller's `meta.run_id` (`api/oss/src/core/workflows/service.py:3822-3830`), so it is not a trusted source. `POST /mounts/agents/sign` learns the agent from its `artifact_id` query parameter (`api/oss/src/apis/fastapi/mounts/router.py:484-510`).

The design adds one claim, `run_agent_id`, beside `run_accounts`. Two places mint a run credential, and both set the claim through one function, `WorkflowsService.resolve_run_agent_id`. `_prepare_invoke` sets it for a run the API starts (playground through the API, sessions the API starts, triggers, evaluations, child runs): the agent is the workflow it resolved itself, or, when the request already carries its revision, the agent its references name, resolved in the caller's project. `GET /access/permissions/check` sets it on a first mint, when the agent service runs a turn for an API key or a browser session and names the turn's agent (`workflow_id`); a renewal carries the claim of the credential it renews and never takes a new one. In every case the API resolves the agent in the caller's project and checks that the run's principal may run it (`RUN_WORKFLOWS`) before it writes the claim; it never copies a raw id from the request. One function reads it: `run_agent_id_of_request(request) -> Optional[UUID]`. The sign routes take the agent from it only. A child run gets its own credential from its own invoke, with its own agent, and is never resolved through its parent. A run with no stored agent (an inline configuration with no agent reference) gets no claim, so it has no home drive. A credential without the claim (no stored agent, or minted by an older API pod) gives no channel exception and no home sign.

**The channel exception** (Proposed). Today a channel turn of a private agent is refused its agent drive (Measured above; not verified live). D2 lets a channel turn sign a private drive only when all of these hold:

1. the principal is a channel installation on its own channel turn;
2. the run's agent (`run_agent_id_of_request`) is private;
3. that agent's owner, the binding's creator and the drive's owner are the same person;
4. the action is `USE_MOUNTS`.

A child run of a channel turn does not get it (its own credential is not a channel turn), and the save check never applies it: an installation that edits an agent is not a saver who may use the owner's private drives. Consequence, stated in the channel binding docs: a private agent on a channel can read its listed drives, so anyone in that channel can ask it about their files. This is the same exposure that the A2 exception already gives for the agent's instructions and tools.

**Where each check runs** (Proposed). The rule is enforced at the drive; the save check only stops configurations that cannot work.

| Where | Check |
|---|---|
| `allow_mount`: every by-id route (files read, write, upload, download, export, delete, edit, archive, app scope, `POST /mounts/{id}/sign`) and the `POST /mounts/query` filter (`api/oss/src/apis/fastapi/mounts/router.py:393-402`, `450-480`) | `evaluate` with `mount_resource` |
| `POST /mounts/sign?slug=&access=` (Decision 7) | role `USE_MOUNTS`, then `evaluate`. A private drive the caller may not use answers 404, the same answer as a missing drive. With `is_home=true`, also `check_home_drive` |
| `POST /mounts/agents/sign`, legacy (Decision 11) | the agent from `run_agent_id_of_request`, which must equal the `artifact_id` parameter; the agent check as today; the legacy condition; `evaluate`; then `check_home_drive`, because this route always signs a home |
| `POST /mounts/agents/query` (`router.py:544-560`) | the agent check as today, then `evaluate` |
| Apps tools `list_starters`, `create_app` (`api/oss/src/core/apps/handlers.py:220-230`) | `evaluate` with the run's principal before any read or write; a denied drive reads as "no drive" |
| Template loader (`api/oss/src/core/agent_templates/loader.py:495`) | writes only into the drive created in the same action (Decision 6) |
| Save (`commit_workflow_revision`, `api/oss/src/core/workflows/service.py:3328`) | Decision 5 |
| Agent visibility change (`api/oss/src/apis/fastapi/sharing/router.py:200-224`) | below |

**The home rule** (Proposed). One function owns it: `SharingService.check_home_drive(agent_policy, mount_policy) -> Optional[reason]`. The rule: when the agent is private, its home drive must be private to the agent's owner; a shared agent has no extra condition (case j). It needs only the agent's id, visibility and owner; it does not read any revision. Four places call it: the save check (Decision 5), `POST /mounts/sign` with `is_home=true`, the legacy route (which always signs a home), and the change of an agent to `private`.

The save check warns early, but a drive's visibility can change after the save, for example when another agent that uses the same home becomes shared (case k). So the rule runs again each time a run signs its home drive. The runner signs the home drive with `is_home=true`. The API takes the agent from `run_agent_id_of_request` and calls `check_home_drive`; a refusal, or a credential without the claim, answers HTTP 403 with the code `home_drive_not_allowed`. The runner then runs without a home: no `.tools/` restore, no `agent-files` link, and the agent is told its home drive is not available.

The run's principal is checked at sign time. So a wrong configuration cannot leak a private drive: a teammate's run of an agent that lists the owner's private drive gets 404, and the runner mounts nothing.

**Credentials outlive a change of rule** (Measured: 12 hours by default, `api/oss/src/utils/env.py:1860-1866`). A signed drive stays usable until its credentials expire, even when the owner leaves, the agent is transferred, the drive is removed from the configuration, or the drive or agent is archived. On `daytona` and `inprocess` the keys sit in the cloud machine with the agent. This design does not shorten the lifetime. The follow-up pull request that signs again on each warm turn must unmount a drive whose new sign fails, remove its link, and tell the agent it is not available in the same turn (Proposed).

**The case table** (Decided rule; Proposed placement):

| Case | Today | What happens | Where it is enforced |
|---|---|---|---|
| (a) A personal agent lists its owner's private drive | the agent drive follows the agent through A2 | Works. Only the owner can run the agent, and the owner may use the drive. | sign route, D2 |
| (b) Someone adds a private drive to a shared agent | only "the slug exists" is checked (`service.py:535-554`) | Save refused: `drive_not_shared` when the saver owns the drive, `drive_not_found` when he does not | save check |
| (b2) A personal agent's home drive is shared | | Save refused: `home_drive_not_allowed` (422). A shared home would let any member plant `.tools/` code that runs in the owner's private runs. | save check |
| (c) A personal agent becomes shared | only `agent_access` changes (`api/oss/src/core/sharing/service.py:568-592`) | The same action makes shared the private drives the agent lists that the acting owner owns, and the response lists them (Decided item 6). If it lists a private drive of another owner, the action is refused with `drive_not_owned` and names the slug. | visibility route |
| (c2) A shared agent becomes personal | | Allowed; its drives stay shared. If its home drive is shared, the action is refused with HTTP 409 `home_drive_not_allowed` until the home is changed (see below). | visibility route |
| (d) A personal agent's conversation is shared with a viewer or Participant | he reads the session drive, not the agent drive (`router.py:550-556`) | He sees the session folder, and a drive only if it is shared. Same as today for the home drive. | `evaluate`, query filter |
| (e1) A schedule or subscription run of a personal agent, created by the owner | allowed by A2 | Uses shared drives and the owner's private drives | sign route, D2 |
| (e2) A run by an API key | an API key never passes A2 | Uses shared drives only. An API key cannot run a personal agent. | sign route, D2 |
| (e3) A channel turn of a personal agent, by the owner's binding | allowed to run; agent drive refused (Measured above) | Allowed to sign the owner's private drives under the conditions above; a child run is not | sign route, D2 exception |
| (f) Two owners want one drive for their personal agents | not possible; a project drive is open to all | They use a shared drive, as a non-home entry. Sharing with named people does not exist. | none |
| (g) The owner leaves the project | the private agent and its drive lock (`api/oss/src/dbs/postgres/sharing/dbes.py:18-23`) | The private drive locks with the personal agent. Shared drives are not affected. Signed credentials work until they expire. | D2: a departed owner fails the member check |
| (h) An agent is archived | signing its drive fails (`service.py:577-602`) | The drive is independent. Other agents that list it keep using it. The legacy route keeps today's refusal. | sign routes |
| (i) A personal agent is transferred to another member | only `agent_access` changes | Its private drives stay with the old owner. The new owner's runs do not get them; the agent is told they are not available. The next save is refused until he removes or replaces them, and the new owner cannot share them through the visibility change (case c). | sign route, save check, visibility route |
| (k) Two personal agents of one owner share a private home drive, and one becomes shared | | The action shares the drive (case c); the disclosure before the change names the other agent that lists it. The other agent's runs then fail the home rule at sign and run without a home; its next save is refused with `home_drive_not_allowed`. | visibility route, home rule at sign |
| (j) A shared agent has a shared home drive | members who can write the agent's drive can already plant `.tools/` code (Measured: the agent drive follows A1) | Unchanged: the same members can write the shared home. | none |

**The visibility change** (Decided item 6, Proposed mechanics). `POST /workflows/{id}/sharing/visibility` with `project` reads the latest revision of every variant of the agent through the same fill as every other read (Decision 5), so a revision without keys shows the agent's own drive (the router already reads revisions, `api/oss/src/apis/fastapi/sharing/router.py:451-461`). It collects the private drives they list. If one of them is owned by someone other than the acting owner, it refuses with HTTP 409, code `drive_not_owned`, and names the slug. Otherwise it writes `project` on those `mount_visibility` rows in the same transaction as the agent row, under the agent's lock (`api/oss/src/core/sharing/service.py:815-866`). The response field `drives_made_shared` lists the slugs. The disclosure that the router builds before the change lists the same drives and the other agents that list them, so the person sees before the change that those agents now use a shared drive.

The change to `private` reads revisions through the same fill and refuses with HTTP 409 `home_drive_not_allowed` when `check_home_drive` fails for the home drive of any variant's latest revision. The person first sets a private home or `null` (Proposed).

| Option for case (c) | Trade-off |
|---|---|
| **A. The same action shares the owner's drives and lists them** | One step for the person; nothing is shared without the disclosure and the response naming it. |
| B. Refuse until the drives are shared by hand | Nothing implicit, but no screen for drives exists, so only the API could do it. |

**Chosen: A** (Decided item 6), limited to drives the acting owner owns.

### Decision 5: the save refusals

Every commit of an agent revision passes through `commit_workflow_revision` (`api/oss/src/core/workflows/service.py:3291`). The check runs in its async body, as today (`service.py:3328-3331`), and answers HTTP 422 with the agent-facing envelope `{code, message, retryable, next_step, details}` that the existing drive errors use (`service.py:535-554`). The agent's own commit tool gets the same envelope as an error result (HTTP 200 with `STATUS_CODE_ERROR`), as today.

| Code | When | `next_step` (Proposed text) |
|---|---|---|
| `invalid_drive_entry` | an entry breaks the rules of Decision 1 | "Correct parameters.agent.drives as the message says, then commit again." |
| `invalid_home_drive` | `home_drive` is not `null` and names no entry, or names a read entry | "Set home_drive to the slug of a read-write entry of drives, or to null." |
| `invalid_session_drive` | `has_session_drive` is not a boolean | unchanged |
| `drive_not_found` | a slug names no active non-session drive in the project, or a private drive the saver may not use | "Create the drive with POST /mounts/, then commit again." |
| `drive_not_shared` | the agent is shared and an entry names a private drive the saver owns | "Make the agent private, or attach a shared drive." |
| `home_drive_not_allowed` | `check_home_drive` fails: the agent is private and `home_drive` names a shared drive, or a private drive of another owner | "Set home_drive to a private drive you own, or to null. Attach shared drives without making them home." |

The check calls `evaluate` with the saver's principal and no channel exception, and `check_home_drive` for the home. It reaches the mounts service through the callable that the composition root sets, because the mounts service depends on the workflows service. Today the callable is `set_project_mount_lookup` (`service.py:528-533`); it is renamed `set_mount_lookup`, stored as `_mount_lookup`, and wraps `fetch_mount_by_slug`.

**No new revision without the keys** (Proposed). One pure function owns the fill: `fill_agent_drive_keys(agent_config, own_drive, agent_policy) -> agent_config`. It runs only when `drives` is absent. It adds `has_session_drive: true`. It adds the agent's own drive (the row found by `agent_id`) as the only entry and as home only when the home rule allows it for the agent's current visibility: a shared agent and a shared drive, or a private agent and a private drive of its owner. Otherwise, or when the agent has no drive row, it writes `drives: []` and `home_drive: null`. An own drive without a `mount_visibility` row (before release 2) follows its agent, so the rule always holds for it and the fill keeps today's behavior. A commit through the new API calls it before the checks, so it never stores an agent revision without `drives`; a first revision with no drive row instead goes through creation (Decision 6). The API calls it when it reads an agent revision that lacks the keys (`_normalize_revision_for_read`, `service.py:852`), so the agent service receives the keys for older revisions too, for example one that an environment still points to. The visibility change and the change to `private` read revisions through the same read path. A filled configuration can name the own drive by its reserved slug before release 2; the sign route accepts it (Decision 7).

The agent's own commit tool cannot change `drives` or `has_session_drive` today (`api/oss/src/core/workflows/change_set.py:580-581`); `home_drive` joins that list (Decided item 10).

### Decision 6: drive creation with the agent

One function owns creation: `MountsService.create_agent_drive(project_id, artifact, visibility)`. The commit hook and the legacy sign route (Decision 11) call it. The slug rule is a pure function, `agent_drive_slug(agent_slug, taken_slugs)`, that it calls. The release 2 migration does not call app services; it carries its own frozen copy of the slug rule (Proposed).

The API creates the agent's drive in `commit_workflow_revision`, just before it stores the first agent revision of an artifact. Every creation path in the table above stores its first revision through this function, so one hook covers them: workflow create followed by a commit, simple create, application create, the template loader, and a future copy action. A variant fork stores a revision of an artifact that already has a drive, so it creates none.

The hook runs when the revision is an agent revision (`flags.is_agent`), no `mounts` row has this artifact in `agent_id`, and the configuration does not opt out through `home_drive`:

| `home_drive` in the first revision | What the API does |
|---|---|
| key absent (default template, older clients) | creates one drive, appends `{ "slug": <new slug> }` to `drives` (creating the list if absent), sets `home_drive` to it |
| `null` | creates no drive (a support agent, or a template that removes it) |
| a slug | creates no drive; the agent uses that existing drive as home, if the save check allows it |

The new drive (Decided item 7, Proposed details):

- Slug: `agent_drive_slug`: `<agent slug>-files`, made safe as one path segment, with `-2`, `-3` ... on a collision in the project. Name: the agent's name.
- `agent_id`: the artifact id (meaning above).
- Visibility: an explicit `mount_visibility` row equal to the visibility the agent will have. The hook runs before the revision is stored, and `_ensure_first_agent_access` runs after (`service.py:3374`), so the hook reads the same inputs: the agent's existing `agent_access` row, or else the row that `_ensure_first_agent_access` will write (project-visible, owned by the request's person), or else `project` with no owner.
- Idempotent: the unique index `uq_mounts_project_id_agent_id` (Migration, release 1) makes the create an upsert keyed on the agent id, so a retried commit reuses the row.

**Template files** (Proposed). The loader writes template files only into a drive created in the same load. When the template's first revision names an existing drive as home, or `null`, the loader writes no files and reports the skipped files in its answer. A template cannot write into a drive that other agents use.

A copy of an agent gets its own new drive when the copy action leaves `home_drive` out of the copied configuration. No copy route exists today (Measured above); the rule is written down for the one that comes.

| Option for when the drive is created | Trade-off |
|---|---|
| **A. At the first agent revision, in the API** | The drive exists before any conversation; the configuration can name it; one hook covers every path. |
| B. At the first run, as today | No change at creation. The configuration cannot name a drive that does not exist yet. |
| C. In each client (web, template loader) | No API hook. Every client must repeat it. |

**Chosen: A.**

### Decision 7: the sign route

The open pull request added `POST /mounts/projects/sign`. With one kind of drive, "project" is no longer a kind of drive; it stays only as a visibility value. The route moves (Proposed):

| Option | Trade-off |
|---|---|
| A. Keep `POST /mounts/projects/sign?slug=` | Built and reviewed. The path keeps a removed kind name, and a reader guesses that other kinds exist. |
| **B. `POST /mounts/sign?slug=&access=`** | The same resource as `POST /mounts/{mount_id}/sign`, addressed by slug instead of id; no kind in the path. Not shipped yet, so the rename costs nothing. |
| C. Sign by id only, `POST /mounts/{id}/sign` | Exists, but always read-write (`router.py:673-702`), and the configuration holds slugs. |

**Chosen: B.** Operation id `sign_mount_credentials_by_slug`, beside `sign_mount_credentials` (by id); the service lookup is `MountsService.fetch_mount_by_slug`. The route is registered before the `/{mount_id}` routes, as the fixed sub-paths are today (`router.py:214`). The naming rules ask for one pattern for every kind and one name per concept; this route is that pattern.

1. Role `USE_MOUNTS`, then `evaluate` (Decision 4). A denied drive answers 404.
2. `fetch_mount_by_slug` excludes session drives by their `session_id`, not by the slug prefix. Rows with `agent_id` are signable by slug, including existing agent drives that still have a reserved `__ag__agent__...` slug before release 2; they pass the same visibility rule as any drive. Today `fetch_project_mount` refuses reserved slugs and rows with `agent_id` (`service.py:962-979`). The reserved-prefix refusal stays on creation only (`service.py:179-182`, `503-516`).
3. `access=read` signs read-only credentials, and the runner mounts read-only, as built and measured live (Decided item 10).
4. `is_home=true` (a boolean query parameter, named by the `is_<adjective>` rule) asks for `check_home_drive` (Decision 4). The runner sets it only for the home drive.

`POST /mounts/agents/sign` stays only for runners older than this change (Decision 11).

### Decision 8: the runner flow

**The wire** (Proposed). The agent service sends `drives: [{ slug, access }]` (access filled in), `homeDrive` (a slug or `null`), and `hasSessionDrive`. A request without `drives` comes from an older agent service, or from a configuration without the key; the runner keeps today's rule: the session drive when there is a session id, and the agent's drive through the legacy route when there is an artifact id, linked at `agent-files` (`run-drives.ts:59-86`). The runner parses the request with a plain JSON cast, so an older runner ignores the new fields (`services/runner/src/server.ts:1922`).

**One code path** (Proposed). One module replaces `agent-mount.ts` and `project-mount.ts` for signing, paths and links.

1. Resolve the run's drives once, into one list of `RunDrive { slug, access, isHome, credentials, mountedPath, linked }` that every later step reads (setup, links, turn-start refresh, remount, credential lease, teardown), as the open pull request already does for project drives (`run-drives.ts:1-12`).
2. Send every sign request at the same time: the session drive, and one `POST /mounts/sign` per drive, with `is_home=true` for the home drive (`environment-setup.ts:129-141`). A refused home sign means no home for this run.
3. Mount every signed drive at `<working folder>-drive-<slug>`, read-only for `read`, in the same parallel group as the session drive.
4. After the session drive is up: link `drives/<slug>` for each drive, link `agent-files` to the home drive, prune leftovers, write `drives/README.md`.
5. For the home drive: seed its `README.md` if absent, restore `.tools/` from it.
6. Prompt: the platform text and the environment notes (Decision 10).
7. Every turn: repair every link (Decision 3 rules), on all three sandbox kinds. Today `agent-files` is not repaired on `daytona` (`run-turn.ts:1464`).
8. The drive list and `homeDrive` join the fingerprint that decides whether a parked sandbox can serve the next turn (`engines/sandbox_agent/session-identity.ts`).
9. A drive whose sign fails is skipped, logged as `mount degraded kind=drive_mount slug=<slug>`, and the agent is told it is not available. If the home drive is skipped, there is no `agent-files/` this turn and no tool restore. Every drive on this path logs `kind=drive_mount`; `kind=agent_mount` stays only on the legacy path.

**Per sandbox kind** (Proposed; the "who mounts, when" table does not change):

| Step | `local` | `daytona` | `inprocess` |
|---|---|---|---|
| Who mounts | the runner's machine, before the harness starts (`mount-lifecycle.ts:27-38`) | the cloud machine, during setup (`environment.ts:1379-1444`) | the command machine, at the first tool call of each boot (`sandbox-drive.ts:297`) |
| Links made | by the runner after the session mount | by a shell script in the machine | in `link()` of the command machine (`sandbox-drive.ts:326-338`) |
| Links repaired | every turn (`run-turn.ts:1464-1479`) | every turn, `agent-files` included (new) | every turn, `agent-files` included (today only project links, `sandbox-drive.ts:321-338`) |
| A drive fails to mount | run continues without it | run continues without it | file commands refused with a sentence that names the drive, chat keeps working, as today for any root |
| `drives/README.md` | written by the runner | written in the machine | written through the store, as the skill snapshot is (`engines/inprocess/workspace/skill-snapshot.ts:1-8`) |

### Decision 9: `drives/README.md`

The platform writes it at every start, from the run's drive list, before the agent's first turn. It is for the agent and for the person who opens the files pane. It lists only the drives mounted in this run. Proposed text, for the "quote" agent above:

```markdown
# Drives

Each folder here is a drive: a folder of files that Agenta keeps after this
conversation ends. This list comes from the agent's configuration.

| Folder | Access | Note |
| --- | --- | --- |
| drives/quote-agent-files/ | read and write | Home drive. Also at agent-files/. |
| drives/price-lists/ | read only | |

Other agents with access to a drive may also write files in it. If two
agents write the same file, the last write wins.

Agenta writes this file again at the start of every conversation. Changes to
it are not kept.
```

With no drives mounted, the table is replaced by "No drives are attached to this agent." The prune rule never removes the file, because it is a file with content (`project-mount.ts:161-193`).

Accepted exposures (Proposed): a viewer of a shared conversation can read the slugs listed in this file, also those of private drives he cannot open. Slugs are unique per project (`api/oss/src/dbs/postgres/mounts/dbes.py:23-27`), so a create that conflicts (HTTP 409) reveals that a slug exists. Neither reveals any file.

### Decision 10: the prompt texts

- With a home drive, the platform text stays word for word as today: the passages that name `agent-files/` (`sdks/python/agenta/sdk/agents/platform_instructions.py:170-264`) still describe the home drive (Decided item 4).
- Without a home drive, the existing variant without the agent drive is used (`platform_instructions.py:350-373`).
- When the list holds other drives, one paragraph (Proposed, replaces `PROJECT_DRIVES_GUIDANCE`, `platform_instructions.py:377-383`): "The drives attached to you are folders under `drives/` in your working directory, one per drive. `drives/README.md` lists them with their access. They keep their files after this conversation. You can link a file in a drive like any other file: `[prices.csv](drives/price-lists/prices.csv)`."
- The runner's environment notes name each drive with its absolute path and access. For a read-write drive: "Other agents with access to this drive may also write files here. If two agents write the same file, the last write wins. Prefer adding new files to editing existing ones. Never delete a folder you did not create." For a read drive: "`drives/<slug>/` is read-only for you." For a drive that is not available: "`drives/<slug>/` is not available in this conversation." The texts never call a drive "shared" because it is writable; "shared" means only the visibility.
- `AGENTA_AGENT_MOUNT_DIR` is not set any more.

### Decision 11: version skew

The runner, the API and the agent service deploy separately. An older part is today's production code (none of the open pull requests merged). The rule (Proposed): **an older part may lose a drive, but it must never gain write access and never cause a drive to be created against the configuration.**

**Rollout order for release 1** (Proposed): agent service, then runner, then API, then web.

- The agent service goes first because the vault middleware of an older agent service treats a run as an agent run only when every key of `parameters.agent` is known (`sdks/python/agenta/sdk/middlewares/running/vault.py:604-659`). It must know `drives` and `home_drive` before any configuration holds them.
- The runner goes before the API because the API is the first part that writes explicit drive configurations (at agent creation). Until then every request carries no `drives`, and the new runner uses the legacy route, which the older API serves as today.
- The web goes last because it reads the new keys.

**The legacy route** `POST /mounts/agents/sign?artifact_id=` (Proposed). An older runner sends only the artifact id. The route takes the agent from `run_agent_id_of_request` and answers 404 when the parameter names another agent or the credential has no claim. It signs, and may create the drive with `create_agent_drive`, only for an agent that has **no stored revision with a `drives` key**. It then finds the row by `agent_id` (never by the slug), applies `evaluate`, and, because it always signs a home, `check_home_drive`. For every other agent it answers 404 and creates nothing. It does not try to infer which revision a run uses. The "has any revision a `drives` key" test runs on every legacy sign, so it is one indexed query.

Consequence: every commit through the new API writes the keys, and release 2 writes them into every stored revision. So after release 2 the legacy route always refuses, and it is deleted in the release after. An older runner loses the drives of every agent that has an explicit configuration. The rollout order (runner before API) keeps that window empty in practice.

| Option for the legacy route | Trade-off |
|---|---|
| A. Read the agent's latest revisions and sign only the read-write home | Older runners keep more drives. A second source of drive selection that guesses the revision, and can be wrong for a deployed older revision. |
| **B. Sign only for agents with no revision that has a `drives` key** | One plain condition; an older runner can lose a drive, never gain one; the route can be deleted after release 2. |
| C. Remove the route now | Clean. Every older runner loses every agent's files during release 1. |

**Chosen: B.**

| Parts (new / old) | What happens | Outcome |
|---|---|---|
| new agent service, old runner and API | Stored configurations have no `drives`; the agent service sends none; the runner works as today | today's behavior |
| new agent service and runner, old API | No `drives` on requests; the new runner uses the legacy route, which the old API serves as today | today's behavior |
| all new | full behavior | |
| new API and agent service, old runner (out of order) | The old runner ignores `drives` and signs the legacy route; the API signs only for agents with no revision that has a `drives` key | loses the drives of agents with explicit configurations; never gains write access |
| new API, old agent service (out of order) | A new agent's stored keys make the old vault miss the agent run | blocked by the order |
| new runner with `drives`, old API (out of order) | Every `POST /mounts/sign` fails; every drive is not available | fails closed |
| old API pod during the release 1 rollout signs an agent created by a new pod | The old pod upserts by the reserved slug; `uq_mounts_project_id_agent_id` refuses a second row; the sign fails; the run continues without `agent-files/` | fails closed, no empty duplicate |
| any older runner after release 2 | Every revision has a `drives` key, so the legacy route answers 404 | the run has no `agent-files/`; fails closed; not part of the ordered rollout |
| release 1 pods and stored revisions after release 2 renames an agent's drive | A revision saved during release 1 names the reserved slug `__ag__agent__<artifact id>__default`. `fetch_mount_by_slug` resolves a reserved agent slug by the agent id it holds, not by an exact slug match | the reference keeps working after the rename |
| old API pod during the API rollout | Old pods decide the by-id file routes and the `POST /mounts/query` filter for a row with `agent_id` by its agent (`api/oss/src/apis/fastapi/sharing/utils.py:493-498`), and ignore `mount_visibility`. A drive whose visibility a new pod changed apart from its agent (for example a private own drive of an agent that became shared) is judged by the agent on old pods until they drain. A run whose credential an old pod minted has no `run_agent_id` claim, so a new pod refuses its home sign and legacy sign. | accepted: a short window until old pods drain |
| old web, new API | The files pane reads the agent's drive through `POST /mounts/agents/query`, found by `agent_id` | `agent-files/` works; other drives not shown |

### Decision 12: the web

- **Files pane** (Proposed). The pane reads `drives` and `home_drive` from the session's agent revision (it already reads the configuration in `projectDrives.ts:31-46`, which is renamed `drives.ts`, without the removed kind), resolves the slugs with `POST /mounts/query` and the `slugs` filter (`api/oss/src/dbs/postgres/mounts/dao.py:348-349`), and folds each drive under `drives/<slug>/`. The home drive is shown once, under `agent-files/`, and its `drives/<slug>/` entry is hidden. A configuration without `drives` keeps today's lookup by the agent id (`agentDrive.ts:13-31`). A slug that does not resolve (missing, or a private drive the viewer may not use) is not shown.
- **Origins.** `FileOrigin` becomes `"session" | "home" | "drive"`; a `"drive"` path carries its slug (today `"session" | "agent" | "project"`, `useSessionDrive.ts:45`).
- **Tool paths.** The mapping matches `-drive-<slug>` first: a tool path under `<session>-drive-<slug>` maps to that drive, and the home slug maps to `agent-files/`. Only then does the old `-agent` suffix map to `agent-files/`, for recorded sessions (`fileActivity.ts:108-109`, `175`). Without this order, `<session>-drive-support-agent` would match the old suffix.
- **Chat links** to `drives/<slug>/...` and `agent-files/...` open the file, as built.
- **Agent page card.** The card lists the drives from the agent's latest revision, with the home drive first, and works before the first conversation because the drive is created with the agent. For a configuration without `drives`, it keeps today's lookup.

For a backend developer: the pane is a function of (configuration, list of drive rows, list of files per row); the change is in that function, not in new routes.

## Names per layer

| Concept | Configuration | Wire | SDK | API | Runner | Web | User-facing |
|---|---|---|---|---|---|---|---|
| a drive | `drives[]` entry | `drives[]` | `AgentDrive(slug, access)` | `mounts` row, `Mount` | `RunDrive` | `"drive"` origin | drive |
| its name | `slug` | `slug` | `slug` | `slug` | `slug` | `slug` | the folder `drives/<slug>/` |
| access (read or read-write) | `access` | `access` | `access` | query `access` | `access`, geesefs `-o ro` | `access` | "read only", "read and write" |
| visibility (who may open) | | | | `mount_visibility.visibility` (`private`, `project`); the sibling `agent_access` is an existing naming exception | | | private, shared |
| home sign | | | | query `is_home=true`; `SharingService.check_home_drive`; error `home_drive_not_allowed` (403 at sign, 422 at save, 409 at the visibility change) | `isHome` | | "home drive not available" |
| save lookup | | | | `set_mount_lookup`, `_mount_lookup`, `fetch_mount_by_slug` | | | |
| home | `home_drive` | `homeDrive` | `home_drive`, `validate_home_drive` | `home_drive` | `RunDrive.isHome` | `"home"` origin | `agent-files/`, "home drive" |
| session drive | `has_session_drive` | `hasSessionDrive` | `has_session_drive` | `get_or_create_session_mount` | `mountedCwd` | `"session"` origin | the working folder |
| visibility rule | | | | `SharingService.evaluate` with `ResourceKind.MOUNT` (`_evaluate_mount`, `mount_resource`), reached by `allow_mount` | | | |
| the agent of a run | | | | claim `run_agent_id` (written by `resolve_run_agent_id` in `_prepare_invoke` and the permissions exchange), read by `run_agent_id_of_request` | | | |
| key fill, slug rule | | | | `fill_agent_drive_keys`, `agent_drive_slug` (pure; the migration has frozen copies) | | | |
| agent's drive creation | | | | `MountsService.create_agent_drive` | | | |
| created with agent | | | | `mounts.agent_id` (legacy route and migration only) | | | |
| sign by slug | | | | `POST /mounts/sign` (`sign_mount_credentials_by_slug`), `fetch_mount_by_slug` | `signMountCredentialsBySlug` | | |
| legacy sign | | | | `POST /mounts/agents/sign` (`sign_agent_mount_credentials`) | `signAgentMountCredentials` | | |
| mount path | | | | | `driveMountPath(cwd, slug)` = `<cwd>-drive-<slug>` | suffix `-drive-<slug>` | |
| folders | | | | | `DRIVES_DIR_NAME` `drives`, `HOME_DRIVE_LINK_NAME` `agent-files` | same | `drives/`, `agent-files/` |
| log | | | | | `kind=drive_mount`, stage `drive_mounts`; `kind=agent_mount` on the legacy path only | | |
| save errors | | | `InvalidAgentDrivesError` | `invalid_drive_entry`, `invalid_home_drive`, `drive_not_found`, `drive_not_shared`, `home_drive_not_allowed` | | | message text |
| visibility change | | | | `drives_made_shared`; errors `drive_not_owned` (409), `home_drive_not_allowed` (409) | | | |
| schema | | | | `mount_visibility`, `uq_mounts_project_id_agent_id`, `ck_mount_visibility_value`, `ck_mount_visibility_private_owner`, `ix_mount_visibility_project_id_owner_user_id` | | | |

## Risks / Trade-offs

- **The visibility rule decides who reads whose files.** It got a security review on this design; the code gets one too (task 0.2). The legacy branch must follow the agent, or a private agent's drive would read as shared before release 2.
- **Code in a home drive runs in every run that uses it.** `.tools/setup.sh` and `.tools/bin` run inside the agent's runs. The rule "a personal agent's home is a private drive of its owner" (case b2) keeps other members' code out of private runs. A shared agent with a shared home has the same exposure as today (case j).
- **Credentials outlive a change of rule** for up to 12 hours (Decision 4).
- **Older runners lose drives** of agents with explicit configurations, and after release 2 all drives (Decision 11). The ordered rollout avoids it; the legacy route is deleted in the release after release 2.
- **The read-time fill** changes what the agent service sees for an older revision: it gains `drives` and `home_drive` naming the drive it already used, so its behavior stays the same.
- **A private agent on a channel** can read its listed drives for anyone in that channel (Decision 4, channel exception).
- **The unique index on `(project_id, agent_id)`** fails the release 1 migration if duplicate rows exist. Only the name `default` is used today (`services/runner/src/engines/sandbox_agent/agent-mount.ts:49-59`), so none are expected; count on a copy of production data first (task 1.2).
- **Rollout window.** Agents created while old and new API pods both serve can run once without `agent-files/` (Decision 11). No data is lost and no empty drive is created.
- **Link repair no longer moves files.** Files written into a real `agent-files` folder (after a lost link) stay in the session folder, and the agent is told the home drive is not available. Today the runner moves them (`agent-mount.ts:219-249`).
- **Transfer of a personal agent** (case i) leaves its private drives with the old owner.
- **A recursive delete in a drive hits every agent that uses it.** Read access is the defense for agents that only read. On the bundled store, overwritten files can be recovered by an operator for 30 days.
- **`local` does not isolate drives between sessions** (`run-plan.ts:443-445`). The visibility rule holds for what a run is signed; on `local` a process can still walk the host's mount root.
- **Last write wins** can lose an edit when two agents edit one file in the same minute.

## Migration

Two releases, by the repo's "expand and contract" rule (`api/AGENTS.md`, "Migration gate"): a database migration runs before the new pods start, and old code runs against the migrated data during the rollout.

**Release 1, expand (schema migration in #8315)** (Proposed):

1. Create `mount_visibility` with its constraints and index (Decision 4).
2. Write a `mount_visibility` row (`project`, no owner) for every existing drive with no session and no agent. Older API pods do not read the table, so this is safe.
3. Check that no two rows of `mounts` share `(project_id, agent_id)`; stop with a clear message if any do.
4. Create the unique index `uq_mounts_project_id_agent_id` on `(project_id, agent_id) WHERE agent_id IS NOT NULL`, replacing `ix_mounts_project_id_agent_id` (`dbes.py:44-49`).

No agent drive row changes. Existing agent drives keep their reserved slugs and follow their agents through the legacy branch.

| Step | Old runner sees | Old API sees | Old agent service sees |
|---|---|---|---|
| 1-4 done, old code everywhere | today | today; its upsert by slug never conflicts, because no row was renamed | today |
| new agent service | today | today | (new) |
| new runner | (new) | serves the legacy route as today | none left |
| new API | none left | old pods during the rollout: may fail a sign for an agent created by a new pod (Decision 11) | none left |
| new web | | none left | |

**Release 2, contract (data migration in #8317)** (Proposed). It ships only after every API pod and agent service runs release 1. One alembic data migration, idempotent, no-op downgrade, in batches:

1. For each `mounts` row with `agent_id`, a reserved `__ag__agent__` slug, and an artifact in the database (static catalog agents are skipped), write a readable unique slug `<agent slug>-files` (with `-2`, `-3` on a collision). The storage prefix does not change, so every file stays where it is. `agent_id` stays.
2. For each such row without a `mount_visibility` row, write one from the agent's `agent_access` row (visibility and owner), or `project` with no owner when the agent has none.
3. For each non-archived agent artifact with no drive row (it never ran), insert one: a row with a readable slug, `agent_id`, the storage prefix rule of `mounts`, and a `mount_visibility` row copied from the agent.
4. Write `mount_visibility` rows (`project`, no owner) for drives without a row that older API pods created during the release 1 rollout.
5. For each agent revision (`flags.is_agent`) whose `data.parameters.agent` lacks a key: add `has_session_drive: true`; add `drives: [{ "slug": <the artifact's drive slug> }]` and `home_drive: <that slug>` when `drives` is absent (the frozen fill; after steps 1 and 2 the own drive has the agent's visibility, so the home rule holds). A revision that states `drives` keeps it. Read `data` as text and merge in Python, because the `jsonb` cast refuses some stored JSON (the approach of the open backfill pull request); write it back as `json`.

6. In every agent revision that names a renamed slug (in `drives` or `home_drive`), including references saved explicitly during release 1 by the fill, replace it with the new slug.

The migration does not call app services such as `create_agent_drive` or `fill_agent_drive_keys`; it carries its own frozen copy of the slug rule and the fill, so it does what it did on the day it was written.

After release 2 every non-session drive has a `mount_visibility` row, and `agent_id` is no longer an input to the visibility rule.

| Step | Old runner (production) sees | API, agent service (release 1) see |
|---|---|---|
| 1 | the legacy route finds the row by `agent_id` and signs while the agent has no revision with a `drives` key | finds by `agent_id`; signs by the new slug once a configuration names it |
| 2, 4 | no change | the rule reads the row; same answer as before |
| 3 | its first run finds the new row by `agent_id` and does not create another | same |
| 5 | the legacy route answers 404 from now on (every revision has the key); the route is deleted in the next release | sends `drives` and `homeDrive`; the runner mounts the same drive at `drives/<slug>/` and `agent-files/` |

After release 2, every stored configuration states its drives, and the read-time default remains only for clients that send a configuration without the keys.

| Option | Trade-off |
|---|---|
| **A. Rename slugs and write revisions in release 2; table, rows and index in release 1** | No old API pod ever runs against a renamed row; every step keeps files findable by `agent_id`. Two releases. |
| B. Everything in release 1 | One release. Old API pods during the rollout upsert by the reserved slug, which no longer exists, and create an empty second drive for every running agent. |
| C. Never rename; let configurations name reserved slugs | No rename. Configurations hold unreadable slugs, and the reserved namespace stops protecting session drives. |

**Chosen: A.**

## Tests

Run with `py-run-tests` in `api` and `sdks/python`, `pnpm test` in `services/runner`, and the web unit tests.

- **SDK**: entry rules (slug, access, duplicates, 8 entries, `kind` refused); `home_drive` rules; absent keys read as legacy and produce no `drives` on the wire; wire golden fixtures with `drives`, `homeDrive`, `hasSessionDrive`; vault recognizes `home_drive`; editor schema; the default template has no `drives` key.
- **API unit**: `_evaluate_mount` through `evaluate` (and no allow for an unknown kind), D1, D2, the legacy branch, each condition of the channel exception, the child-run refusal; every case of the table in Decision 4; the save codes, `home_drive_not_allowed` included; the visibility change (shares only the acting owner's drives, `drive_not_owned`, the refusal to make an agent private with a shared home); drive creation on each path (create plus commit, simple create, template load; fork creates none; `home_drive` null or a slug creates none; a retry creates one); the visibility row of a new drive; template files only into a drive created in the same load; `POST /mounts/` refuses `agent_id`; the legacy route signs only for agents with no revision that has a `drives` key and never creates otherwise; `check_home_drive` from each of its four callers, including a credential without `run_agent_id`; `run_agent_id` is written from the resolved workflow and never from caller meta; a child run carries its own agent; `fetch_mount_by_slug` signs a reserved agent slug and never a session row; the commit and read fills, including the fill of `drives: []` when the home rule does not allow the own drive; `POST /mounts/sign` signs rows with `agent_id`; the apps tools call `evaluate`.
- **API acceptance**: read-only credentials read and list, and fail to put and delete; a private drive is 404 for another member and for an API key.
- **Migrations**: release 1 table, rows, index, and the duplicate check; release 2 on a database with legacy rows, never-run agents, private and ownerless agents, static catalog ids, revisions with and without keys, and stored JSON that the `jsonb` cast refuses; a second run changes nothing.
- **Runner unit**: one sign per drive, all at once; mount paths `<cwd>-drive-<slug>`; `agent-files` links to the home drive and is absent without one; link rules (real folder kept, empty file replaced, leftovers pruned, README kept); per-turn repair on each sandbox kind; `drives/README.md` lists only mounted drives; `.tools` restore from the home drive; legacy request uses the legacy route; log kinds; fingerprint includes `drives` and `homeDrive`.
- **Runner integration**: `tests/integration/inprocess/sandbox-drive.test.ts` with three roots, one the home drive, one failing.
- **Web unit**: the fold with a home drive, other drives, a hidden duplicate, an unresolved slug, a legacy configuration; tool-path mapping for `-drive-<slug>` (including a slug that ends in `-agent`) and the old `-agent`.
- **Live**, once per sandbox kind: an existing agent before and after release 2 finds its files at `agent-files/`; a crew shares a drive; a read drive refuses writes; a support agent has no `agent-files/`; a personal agent's private drive is not available to a teammate's run; a channel turn of a personal agent gets its home drive; an older runner cannot mount a drive the configuration made read-only.

## What could not be verified

- That a channel turn of a private agent is refused its agent drive today. It comes from reading the code.
- That no run path mints a run credential outside `_prepare_invoke` and the permissions exchange. Live QA found the second path (a turn the agent service runs for an API key or a browser session); both now set `run_agent_id`.
- That every agent run reads its revision through `_normalize_revision_for_read`, so the read-time fill reaches the agent service.
- That no two `mounts` rows share an agent id in production data.
- That every harness behaves the same with two links to one mount (`agent-files` and `drives/<home slug>`).
- How many agent revisions and drive rows release 2 touches, and how long it runs on the largest database.
- Whether the playground editor keeps `home_drive` when it saves.
