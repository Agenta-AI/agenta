## Context

Code read at `origin/release/v0.128.14` (commit 06534f1beb). The drive model comes from the open pull request 8315.

Today:

- **Static catalog.** Platform workflows live in a Python dictionary in the API (`api/oss/src/core/workflows/static_catalog.py:365`). A reserved `__ag__*` slug resolves in every project with no database row, and a user can never shadow it (`api/oss/src/core/workflows/service.py:2384-2402`). A change ships with the API image.
- **Build kit.** `__ag__build_kit` is an overlay that the playground merges onto a copy of the user's own agent (`api/oss/src/core/workflows/build_kit.py:20-26`). Its tools are listed in `build_kit.py:35-62`, each with `"permission": "allow"` (`build_kit.py:108-116`). Trace tools left the kit on 2026-09-07 (`build_kit.py:33`).
- **Target of platform tools.** The config tools bind the target variant from the run (`$ctx.workflow.variant.id`), never from the model (`api/oss/src/core/tools/dtos.py:396-400`; `platform_handlers.py:732-749`).
- **Levels.** Only organization and project exist. Agents, keys, drives and traces belong to a project (see `notes/03-rights-scopes.md`).
- **Identity of a run.** A run that a person starts in the browser carries that person as its principal, with their role and their private items (`api/oss/src/middlewares/auth.py:587-600`).
- **Private agents.** A private agent is visible only to its human owner, not even to the organization owner (`api/oss/src/core/sharing/service.py:193-206`). Runs started with an API key see no private agents.
- **Keys with limited rights.** The field that would limit a credential to one agent exists, but every value is refused (`api/oss/src/core/access/service.py:601-605`).
- **Templates.** A template load copies the template into the project. Existing copies never get later changes.
- **Drives (pull request 8315).** A drive is a project folder with a slug and its own visibility, shared or private. An agent configuration lists drives by slug in `parameters.agent.drives` and may name a `home_drive`. The API creates an agent's drive when it stores the agent's first revision.
- **Cross-agent tools (pull request 7409, open).** Four tools: `list_agents`, `read_agent_config`, `create_agent`, `edit_agent_config`, through `POST /tools/call`. They check `VIEW_WORKFLOWS` or `EDIT_WORKFLOWS` in the project and answer `agent_not_found` for private agents the caller cannot see.

## Goals / Non-Goals

**Goals:**

- One builder agent that every project has, with one definition that the platform owns.
- The rights of the builder agent are the rights of the person who chats with it, enforced by the API.
- The builder agent can work on other agents of the project.
- The team of a project shares what the builder agent learns.
- One update path for the cloud and for self-hosted instances.

**Non-Goals:**

- Changing or removing the build kit.
- Work across projects or across the organization.
- A service identity for the builder agent, or runs without a person.
- Moving the tools to plugins.
- Large tool results. The builder agent's tools return results the same way as the other platform tools, and the runner cuts a result above 100 KB with a message to narrow the query (`services/runner/src/tools/callback.ts:59`, `:80-83`). Writing large results to a file for the agent to read is in the backlog for later in the project.

## Decisions

### 1. Scope: one shared builder agent per project, acting as the person

| Option | Trade-off |
| --- | --- |
| **A. One shared builder agent per project; each run acts as the person who chats** | **Rights already exist; learning stays per project; the person stays responsible. Cannot see other projects.** |
| B. Same as A, only admins may use it | Simpler to explain, but members cannot build, and it adds no safety, because the agent never has more rights than the person |
| C. Shared builder agent with its own identity | Can run without a person, but sees no private agents and needs service accounts and limited keys, which do not exist |
| D. Organization wide | Could copy agents between client projects, but needs a new access model above the project |

Decided on 17 November 2026: A. A role setting that limits who may use it can come later.

### 2. Abilities: platform tools with a rights check on each target agent

| Option | Trade-off |
| --- | --- |
| **A. Platform tools that check the person's rights on each target agent** | **The API enforces rights; a tool change needs a release** |
| B. Skills of scripts with an API key, as in the proof of concept | Fast to change; the only limit on rights is a sentence in the instructions |
| C. Plugins (pull request 7945) | Versioned and shared with users' agents; today a plugin lives in one project, has no install path, and its calls have a short time limit |

Decided on 17 November 2026: A. Plugins can carry the tools later.

### 3. Update path: a static catalog entry shipped with each release

| Option | Trade-off |
| --- | --- |
| **A. Static catalog entry in the API code** | **Same path for cloud and self-hosted; no copies to upgrade; each change waits for a release** |
| B. Template copied into each project | Each project can change its copy; copies never get fixes without a new upgrade path |
| C. Served from our cloud, pulled by each instance | Changes without a release; a new service; self-hosted instances must reach our cloud |

Decided on 17 November 2026: A. The tools are API code, so the instructions and the tools change together. Fast iteration continues on the proof of concept in the development copy.

### 4. Approvals are a setting with platform defaults

Each tool entry already carries a `permission` (`build_kit.py:108-116`). The builder agent's catalog entry sets `ask` for `create_agent` and `edit_agent_config`, and `allow` for `list_agents` and `read_agent_config`. The interface may hide some of these settings. Decided on 17 November 2026.

### 5. Learning lives in one shared drive per project

The builder agent's configuration lists one shared drive with a fixed slug. A skill tells it what to save there. Later the fast learner and the slow learner list the same drive. Learning is per project, not per person. Decided on 17 November 2026.

Pull request 8315 creates an agent's drive at the agent's first commit, and the builder agent is never committed in a project. The drive sharing work answered how to fill this gap (checked against `origin/feat/drive-sharing`, commit 4d96040611):

| Option | Trade-off |
| --- | --- |
| **Create the shared drive on the builder agent's first run in the project** | **No drive for projects that never use it; one new step at run start** |
| Create it when a project is created, plus a backfill | Simple at run time; makes drives in every project, also unused ones |

Chosen: first use. Confirmed on 17 November 2026. One step next to the run credential mint calls `ensure_agent_drive` with a fixed slug and name from the catalog entry. That function already accepts an agent with no row and gives the drive shared visibility with no owner (`api/oss/src/core/workflows/service.py:618-665` on that branch). A caller cannot create a drive with an `__ag__` slug through `create_mount` (`api/oss/src/core/mounts/service.py:145-148`), and `POST /mounts/sign` never creates a drive, so the step must use `ensure_agent_drive`. Other jobs, such as the learners, find the drive by the builder agent's fixed id with `fetch_agent_drive`.

**No home drive.** The builder agent lists the shared drive and sets `home_drive` to `null`. A home drive holds `agent-files/.tools/setup.sh`, which the runner runs at session start. In a team drive that any member or job can write, a home drive would let one member plant code that runs in every member's run.

Known effects for a static agent:

- The save checks never run for it, so a wrong slug shows up only at run time, where the runner skips the drive and tells the agent.
- The web files pane reads revisions only from the database, so it would not show the builder agent's drive. The files pane must read static revisions.

### 6. Pull request 7409 is reused in a trimmed form

Decided on 17 November 2026:

- Retarget it to the current release branch.
- Remove the four tools from `DEFAULT_BUILD_KIT_OPS` and from the defaults of new agents.
- Remove the instruction that tells an agent to ask before it changes itself.
- Add the `EDIT_WORKFLOWS` decision on the target agent (open review comment at `platform_handlers.py:1643` in the pull request).
- Fix the other open review comments and the failing web unit, SDK unit and API acceptance checks.
- Move its fixes to agent saving (refuse a configuration the runtime cannot run, on every save) into their own pull request first.

## Risks / Trade-offs

- Each change to the builder agent waits for a release. Mitigation: iterate on the proof of concept and the test bench in the development copy, then port.
- A person with a narrow role gets a builder agent with narrow abilities. For example, without `VIEW_SPANS` it cannot read traces. This is the intended effect of decision 1.
- Agents created through a tool must belong to the person. A browser run sets the owner (`api/oss/src/core/sharing/service.py:1028-1061`), but nobody has traced it for agents that a tool creates. Task 2.7 checks it.
- The builder agent chooses the visibility of a new agent through the `create_agent` parameter, following its instructions and the person's answer. A wrong choice is visible to the person in the approval request, because create asks first.
- The shared learning drive lets one person's correction affect how the builder agent works with teammates. This is the intended effect of decision 5.
- Any member can write the shared drive, so a member can change what the builder agent learned. The builder agent has no home drive, so no member can plant code that runs at session start.

## Migration

No data migration for the builder agent itself, because a static catalog entry has no rows. The learning drive is created on first use, so no backfill is needed. The build kit and existing agents do not change.
