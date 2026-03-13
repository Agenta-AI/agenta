# OS Process, State, and Location Working Note

## Status

This is a working note.

It is meant to log and organize the emerging model before we turn it into a cleaner structure.

## Current reading

The current OS folders are mostly describing the process side of an organizational section.

That means they talk about things such as:

- sections and scope
- interfaces
- activities
- actors and critics
- skills
- agents
- artifacts
- what goes where
- who does what

So the current `product-os`, `gtm-os`, `system-os`, and `sre-os` should be read first as operating systems in the sense of process and operating model.

## Emerging split

The model now seems to want an explicit split between:

- `process`
- `state`

For each OS, we may therefore have:

- a process side
- a state side

These are conceptually part of the same OS, but they may live in separate places physically.

## Current OS set

For now, the main organizational OS set is:

- `product-os`
- `gtm-os`
- `system-os`
- `sre-os`

Each one should eventually have at least:

- `layer.md`
- `process.md`
- `state.md`

Current reading of those files:

- `layer.md` = scope, overlaps, distinctions, and interfaces
- `process.md` = loops, activities, roles, skills, agents, artifacts, and operating logic
- `state.md` = what that section knows, owns, reads, writes, and feeds back

## Agent and project

The previous layered discussion also had:

- `agent`
- `project`

Those do not fit cleanly as just another section like product or GTM.

They seem to play different roles.

### Agent OS

The `agent` layer now looks like another OS.

Provisional reading:

- `agent-os` is the entry-point layer for agents
- it names and organizes the different agents
- it maps them to the different organizational OSs
- it connects agent entry points back to `product-os`, `gtm-os`, `system-os`, and `sre-os`
- it covers the agent layer rather than one business or system function

So `agent-os` is less about owning product or system truth directly, and more about how agents enter, use, and coordinate against those other OSs.

### Project state

The `project` part reads less like another OS and more like the ongoing state of project execution.

Provisional reading:

- project state is the live state of a project or work slice
- it is what agents work against during execution
- it is specific to the current project, branch, task, or V-loop iteration
- it is not the same as durable product, GTM, system, or SRE state

So the project surface may be better understood first as a state surface rather than as a full OS.

## State by OS

The current shape suggests:

- `product-os` has product state
- `gtm-os` has GTM state
- `system-os` has system state
- `sre-os` has SRE state
- `agent-os` would have agent entry points, agent definitions, and agent-operating state
- `project` holds ongoing execution state across concrete initiatives and slices

This also means:

- system state is mostly the state side of `system-os`
- product state is the state side of `product-os`
- GTM state is the state side of `gtm-os`
- SRE state is the state side of `sre-os`

## Process vs state

The cleanest reading right now is:

- OS process = how work is done in that section
- OS state = what that section currently knows, owns, tracks, and updates
- project state = the active execution state for a specific project or slice
- agent OS = the operating entry surface that lets agents act across the other OSs and against project state

## Where things live

Provisional placement:

- organization-level OS process docs live under `docs/sdlc/projects/agentic-organization/<os>/`
- `layer.md` captures boundaries and interfaces
- `process.md` captures operating logic
- `state.md` captures the state and knowledge model for that OS

Provisional additional placement:

- cross-OS synthesis notes can live at the root of `docs/sdlc/projects/agentic-organization/`
- transitional or older exploratory notes can live under `docs/sdlc/projects/agentic-organization/misc/`

Provisional reading for agent and project placement:

- `agent-os` may need both a docs surface and an implementation surface
- the docs surface would likely live under `docs/sdlc/projects/agentic-organization/agent-os/`
- the implementation and entry-point surface may continue to live under `.agents/`
- live project execution state likely does not belong in the OS process docs
- live project execution state may instead live in project-local surfaces such as project docs, project memory, active artifacts, evidence, and branch-local working state

## Public and private placement

There may also be a split between:

- public OS surfaces
- private company OS surfaces

Provisional reading:

- the open-source repository may contain the agent entry surface
- it may also contain the project-execution surfaces needed for work happening in that repository
- that means `agent-os` may be public at least in its entry-point and operating form for that repo
- project state for work in that repo may also live there, at least in the portions needed by agents and humans working in that repo

At the same time:

- the fuller company OS surfaces may live in private repositories
- that may include fuller `product-os`, `gtm-os`, `system-os`, and `sre-os` material
- those private OS surfaces may still be made discoverable to agents and humans through a connected mount point, pointer layer, or submodule-like inclusion

So a useful working distinction may be:

- public repo = local agent entry points and local project-execution state for that repo
- private company repos = fuller organizational OS process and state surfaces

This would let:

- the open repository remain usable on its own
- agents still discover and access richer private organizational context when allowed
- humans and agents share one discoverable connection point rather than hard-coding hidden locations ad hoc

## Discoverability requirement

If OS surfaces are split across public and private repositories, the key requirement is not that everything lives together.

The key requirement is that the connection remains discoverable.

That means agents and humans should be able to find:

- what OS surfaces exist
- which are public
- which are private
- where the entry points are
- how the private surfaces connect back to local repo work

So the main design principle here is:

- separate physical location is acceptable
- hidden or non-discoverable coupling is not

## Important distinction

The `state.md` files should not be confused with the actual mutable live state of a running project.

They may instead describe:

- what kinds of state exist
- what that OS owns
- what inputs it reads
- what outputs it writes
- how state feeds back into other OSs

So there is likely a difference between:

- `state model docs`
- `actual live state locations`

## Working hypothesis

The emerging model may be:

1. organizational OS docs define process and state models
2. `agent-os` defines how agents enter and operate across those OSs
3. project surfaces hold the active mutable execution state
4. stable truth can later be distilled into canonical process, product, system, or other durable documentation

## Open questions

- Should `project` eventually become `project-os`, or should it remain a project-state surface rather than an OS?
- Should `agent-os` live mainly in `.agents/`, mainly in `docs/sdlc/projects/agentic-organization/`, or in both with a clear split?
- Which parts of `agent-os` belong in the public repo versus private company repos?
- How much of `state.md` is descriptive schema versus a pointer to where live state actually resides?
- What exactly are the canonical live locations for project execution state, project memory, artifacts, findings, and evidence?
- What is the canonical discoverability mechanism for private OS surfaces: submodule, pointer docs, registry, mounted path, or something equivalent?
- Which parts of the current `misc/` notes should later move into `agent-os` versus the four organizational OS folders?
