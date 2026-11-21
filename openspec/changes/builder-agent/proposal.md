## Why

A person who builds agents on Agenta needs one agent to talk to that builds, runs, tests and changes the working agents of a project. Today two builders exist, and neither one can be that agent for real users:

- The build kit in the product (`__ag__build_kit`) lets each agent change only itself in the playground. Its tools take the target agent from the run, so the model cannot reach another agent (`api/oss/src/core/tools/platform_handlers.py:732-749`).
- The proof of concept in the development copy is an ordinary agent with a project API key and a skill of scripts. The key carries the full rights of the person who made it, and the agent cannot see private agents. Its only limit on rights is a sentence in its instructions.

We decided on 17 November 2026 that the builder agent is a separate agent that the platform provides.

## What Changes

- Add the builder agent as one entry in the static workflow catalog, beside the build kit. Every project in the cloud and on self-hosted instances has it, and nobody can change it from inside a project.
- Each run of the builder agent acts as the person who chats with it, with that person's role. Its conversations are private to that person by default, and the person can share one with the project, as with any agent.
- Give the builder agent platform tools that list, read, create and edit other agents of the project. Each tool checks the person's rights on the agent it touches. The tools come from pull request 7409.
- Approvals for the builder agent's tools are a setting, as on any agent. The platform sets the defaults: create and edit ask the person first, list and read run without asking.
- The builder agent saves the preferences and lessons it learns in one shared drive per project. A skill tells it what to save and how.
- A new version of the builder agent ships with the API release.

Out of scope: what happens to the build kit, reach across projects or across the organization, a role setting that limits who may use the builder agent, moving the tools to plugins, and writing large tool results to a file (in the backlog for later).

## Capabilities

### New Capabilities

- `builder-agent`: the platform-provided builder agent, its scope, identity, approvals, learning drive and release path.
- `cross-agent-tools`: platform tools with which an agent lists, reads, creates and edits other agents of its project under the caller's rights.

### Modified Capabilities

None. The build kit keeps its current behavior.

## Impact

- API: a new static catalog entry in `api/oss/src/core/workflows/static_catalog.py`; four platform tool handlers in `api/oss/src/core/tools/platform_handlers.py` (from pull request 7409); the SDK op catalog `sdks/python/agenta/sdk/agents/platform/op_catalog.py`.
- Drives: depends on the drive model of pull request 8315 (drives by slug, with visibility). The builder agent's shared drive is created on first use with `ensure_agent_drive`, and the web files pane must read static revisions.
- Web: the person needs a place to open the builder agent in a project. Not designed in this change.
- Pull request 7409 is reused in a trimmed form. Its fixes to agent saving move to their own pull request first.
