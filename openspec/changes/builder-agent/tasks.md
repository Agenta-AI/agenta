## 1. Fixes to agent saving (can start now, in parallel with section 3)

- [ ] 1.1 Move the save fixes from pull request 7409 into their own pull request on the current release branch: refuse a configuration the runtime cannot run on every save, key a nameless single `tools` entry by its type, and seed `skills: []` in the template.
- [ ] 1.2 Run the API and SDK unit tests for agent saves.

## 2. Cross-agent tools (after 1)

- [ ] 2.1 Retarget pull request 7409 to the current release branch.
- [ ] 2.2 Remove the four tools from `DEFAULT_BUILD_KIT_OPS` and from the defaults of new agents.
- [ ] 2.3 Remove the instruction text that tells an agent to ask before it changes itself.
- [ ] 2.4 Add the `EDIT_WORKFLOWS` decision on the target agent in `edit_agent_config`.
- [ ] 2.5 Fix the open review comments and the failing web unit, SDK unit and API acceptance checks.
- [ ] 2.6 Add a `visibility` parameter (`private` or `project`, default `private`) to `create_agent`. In pull request 7409 the tool takes only `name`, `description` and `operations`.
- [ ] 2.7 Test that an agent created through `create_agent` in a browser run belongs to the person and has the requested visibility.

## 3. Learning drive (in parallel with 1; after the drive sharing pull requests merge)

- [ ] 3.1 After the drive sharing pull requests merge, add one step next to the run credential mint that calls `ensure_agent_drive` for the builder agent with the fixed slug and name from its catalog entry.
- [ ] 3.2 Make the web files pane read static revisions, so the builder agent's drive shows there.
- [ ] 3.3 Write the learning skill: what the builder agent saves, in which files, and when.

## 4. Builder agent catalog entry (after 2 and 3)

- [ ] 4.1 Add the builder agent entry to `api/oss/src/core/workflows/static_catalog.py` with its instructions, skills, tool list, the learning drive in `drives`, and `home_drive: null`.
- [ ] 4.2 Set the approval defaults: `ask` for `create_agent` and `edit_agent_config`, `allow` for `list_agents` and `read_agent_config`.
- [ ] 4.3 Port the instructions and skills from the proof of concept, without API keys or scripts. The instructions tell the builder agent to ask the person whether a new agent is only for them or for the team, unless the answer is clear.
- [ ] 4.4 Add a place in the web app where a person opens the builder agent in a project.

## 5. Tests

- [ ] 5.1 Unit and acceptance tests for each scenario in `specs/builder-agent/spec.md` and `specs/cross-agent-tools/spec.md`.
- [ ] 5.2 Run the test bench scenarios against the builder agent on a local deployment.

## 6. Next tools (later)

- [ ] 6.1 Test runs of another agent.
- [ ] 6.2 Reading traces of another agent.
- [ ] 6.3 Schedules and subscriptions for another agent.
