# Agent HTML apps: tasks

> Status: **draft implementation audit**. Checked against
> [PR #6972](https://github.com/Agenta-AI/agenta/pull/6972) at
> `b907e49bd237be4f50596503fdefb4b6e5d34bd5` and its acceptance notes on 2026-09-20.
> Product behavior is defined in [specs.md](specs.md). The visual design and later phases remain
> in [index.html](index.html) and [plan.html](plan.html).

`[x]` means the current implementation contains the behavior or the recorded verification passed.
`[ ]` means code, correction, or verification is still required. Items under **Required before
phase 1** are current deltas, not future roadmap ideas.

## Implemented in PR #6972

### Bridge and file contract

- [x] Versioned `MessagePort` protocol and `window.agenta` stub.
- [x] Eight folder-relative file methods: read, read JSON, write, write JSON, list, exists, stat,
      and remove.
- [x] Stable bridge errors and 4 MB read / 1 MB write limits.
- [x] Automatic ETag cache, `If-Match`, conflict mapping, re-read recovery, and forced overwrite.
- [x] `changed`, visibility, theme, navigation, and script-error messages.
- [x] Real host and mock host share the behavioral contract.

### API and server boundary

- [x] Mount reads and listings return ETags.
- [x] Mount writes support `If-Match` and `If-None-Match` and use native conditional put.
- [x] Mount deletes accept `If-Match` with the documented stat-compare-delete race.
- [x] Signed folder-scope token with project, mount, prefix, level, and expiry.
- [x] Token mint route and frontend token refresh.
- [x] Bridge calls send `X-Agenta-App-Scope`; server routes narrow normal project permissions.

### Run surface

- [x] Feature-flagged Source, Preview, and Run modes in the drive HTML viewer.
- [x] Manifest parsing and folder recognition.
- [x] Read and read-write grant sheet with browser-session persistence.
- [x] A manifest access increase asks for a stronger grant.
- [x] Same-folder assembly for styles, scripts, and assets.
- [x] In-folder navigation and reload-files behavior.
- [x] Design kit injection, theme tokens, and Storybook stories.
- [x] Run sandbox and content security policy close the tested fetch, popup, form, and WebRTC
      exits.
- [x] Preview content security policy closes nested frame, object, and connection exits.

### Agent creation

- [x] `agenta-apps` skill assembled into the build kit.
- [x] `list_starters` and `create_app` in the API and SDK platform operation catalogues.
- [x] Bundled `board@1` starter with manifest, config defaults, data behavior, and skill.
- [x] `create_app(update=true)` preserves manifest data and config files.
- [x] Agent-level `.apps/` layout and per-session registry rules in the skill.
- [x] Agent-authored starter descriptions are listed from `.apps/starters/`.

## Required before phase 1

### Security and correctness

- [ ] **Scope a pathless listing to the token prefix.** A request with
      `X-Agenta-App-Scope` and neither `path` nor `read` currently passes `path=None` through
      `enforce_app_scope` and lists the mount root. Resolve the token prefix as the effective list
      path. Add a route test that proves a scoped caller cannot list sibling folders.
- [ ] **Use valid JSON in agent instructions.** Quote keys and use valid placeholder values in
      `skill/sections/08-agent-level.md`, the assembled skill, and `board@1/SKILL.md`. Agents can
      copy these examples into persisted files.
- [ ] **Reject duplicate board column IDs.** `normaliseConfig` currently accepts them, and the
      next normalization can collapse cards into the last duplicate column.
- [ ] **Reconcile external changes after read-only edits.** A read-only board can become `dirty`
      without scheduling a save. A later `changed` event then remains pending until a full page
      reload because reload waits for `!dirty`.
- [ ] **Reset Run navigation when the entry file changes.** `RunView` keeps `currentPath` and its
      back stack from the previous entry while Run remains selected.

### Repository gates

- [ ] Run Ruff formatting on `api/oss/src/apis/fastapi/mounts/router.py`. The current Python
      format check fails on this file.
- [ ] Correct the import order in `htmlApp/fsClient.ts`. The current TypeScript lint check fails
      because `./scopeToken` appears before `./protocol`.
- [ ] Re-run the full pull request checks. Unit, build, and Storybook jobs are currently skipped
      because the format and lint jobs fail first.

## Verification still required

The `/m` wide and phone layouts have a recorded manual pass. The API unit suite recorded 930
passing tests, and selected entity tests recorded 40 passing tests. These cases remain open:

- [ ] Run the same acceptance flow on the desktop host. Only `/m` was exercised manually.
- [ ] Verify the viewer-role grant behavior with a second project member.
- [ ] Run a real agent turn that calls `list_starters` and `create_app`, creates `board@1`, updates
      the session registry, and reads a board change made by the person.
- [ ] Verify a live external agent edit produces `changed` and refreshes the open board.
- [ ] Drive the conflict path in the UI: change `board.json` elsewhere during an edit, receive
      `412`, re-read, merge, and retry without data loss.
- [ ] Verify markup with an external script, a CDN reference, a sibling-folder reference, and a
      parent-folder reference is refused or neutralized as specified.
- [ ] Run the Storybook accessibility test and visual comparison for the new HTML application
      stories.
- [ ] Exercise the stricter egress tests in a browser-like test environment. The current host
      test can skip `window.postMessage` when `window` is unavailable, and the WebRTC assertion
      should prove constructor neutralization rather than only finding constructor names in the
      stub text.

## Implemented limitations to keep explicit

- [x] Conditional delete is a stat-compare-delete sequence. It can delete a write that lands
      between comparison and deletion. Native conditional put has no equivalent gap.
- [x] Agent file tools write without ETags. The skill requires read-before-write, but the server
      does not prevent an agent from overwriting a newer application edit.
- [x] Grants live only in browser session storage. A new browser session asks again.
- [x] The scope token expires after 30 minutes and the frontend refreshes it before expiry.
- [x] Application data remains in the session drive. The agent-level `.apps/` folder contains
      records and starter descriptions, not the live application data.
- [x] The agent-level registry is a skill convention. No server-side registry service enforces
      it.

## Deferred work

### Next bridge additions

- [ ] Add `window.agenta.user` and location state.
- [ ] Add `window.agenta.chat.draft(text)` with a user-controlled send.
- [ ] Add the Refresh action for `refresh.prompt` and schedule readout.
- [ ] Add capped manifest asset preload.
- [ ] Add one-click error relay after composer drafts exist.

### Application catalogue and canvas

- [ ] Render manifest folders as application tiles and open them as Run tabs.
- [ ] Add checklist, review queue, form, sheet, and dashboard starters.
- [ ] Add the approved inlined library shelf, canvas helper, whiteboard, chart, and diagram
      starters.
- [ ] Copy agent-authored starters through `create_app`.
- [ ] Add user-initiated `promote_app` with application data removed from the promoted template.
- [ ] Add per-agent design-kit token overrides.

### Workspace and lifecycle

- [ ] Build the shared two-pane workspace package and persist tab references without file bytes or
      grants.
- [ ] Host the workspace on desktop and `/m`, then measure two streaming sessions plus an
      application iframe before scheduling multi-session panes.
- [ ] Decide whether agent duplication copies `agent-files/` and what agent deletion does to its
      mount.
- [ ] Expose file versions and restore only when a concrete recovery need justifies the API.

## Out of scope

- Direct network access from a running application.
- Direct Agenta API access or authentication material inside the iframe.
- Model calls or platform tool calls from phase 1 applications.
- Per-action permissions such as moving cards without creating them.
- A semantic application event protocol. Phase 1 stores shared meaning in files.
