# Plan: Artifacts

> Future plan. Start only after a separate review approves the product and security
> decisions in this workspace.

## Phase 1: Define the artifact contract

1. Reserve `artifacts/<name>/` inside the agent mount and use `index.html` as the entry
   point. Start with a single durable `state.json` convention.
2. Define ownership and lifecycle: an artifact is agent-created, its directory is its
   capability boundary, and the mount is the source of truth.
3. Define stale-write handling using revisions or checksums. Decide whether an artifact
   may write application files or only its state files in the first release.
4. Specify the sandbox policy separately from the file contract: scripts are allowed;
   Agenta APIs, credentials, parent access, and external network are not.

## Phase 2: Build the artifact runtime

1. Serve or render artifact files in an isolated web context with relative assets.
2. Implement scoped state persistence through local-storage mirroring or relative file
   reads and writes. Debounce writes and expose saving, saved, error, and conflict state.
3. Enforce root-relative paths, file-size limits, rate limits, and permission checks.
4. Add tests for isolation, path escape rejection, state writes, stale writes, and
   cleanup on close or reload.

## Phase 3: Give agents a skill and toolkit

Create a new **artifacts skill**. It should tell an agent when an artifact is appropriate:
when the user needs a shared object to manipulate or inspect, not merely a question with
bounded answers. It should also teach:

- The folder and state conventions.
- The sandbox limits and persistence API.
- How to explain the artifact to the user and invite them to work in it.
- How to read the resulting state on a later turn.
- When to use a questionnaire or approval instead.

Create an **artifact build toolkit** used by that skill. It should provide a tiny starter
application, state helpers, validation, a preview command or test harness, and reusable
templates. The toolkit gives agents reliable primitives without defining a new UI DSL.

Initial templates:

- CRM workspace.
- Go-to-market planner.
- Project or launch board.
- A small editable brief or decision canvas.

## Phase 4: Add the playground work area

1. Add an Artifacts section beside the agent's files. It lists available artifacts with
   title, state, and last-change information.
2. Open an artifact in a contained work area. The user can expand it, return to chat, and
   keep the conversation and artifact visible together.
3. Provide a file inspector and a clear reset or reload action. Show save errors and
   conflicts where the user works.
4. Make the agent aware of changed artifact paths on the next user turn without granting
   the page any direct agent-control capability.

## Release gates

- Security review approves the sandbox and scoped-write design.
- A template-driven CRM and go-to-market flow both persist user changes that the agent
  correctly reads on a later turn.
- The user can identify agent-created content, recover from a broken artifact, and inspect
  the underlying state.
- Existing questionnaire and approval flows remain the recommended choice for bounded
  structured input.

