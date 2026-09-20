# Agent HTML apps: specs

> Status: **draft, reconciled with the current implementation**. This document describes the
> phase 1 behavior implemented on [PR #6972](https://github.com/Agenta-AI/agenta/pull/6972) at
> commit `b907e49bd237be4f50596503fdefb4b6e5d34bd5`. The implementation is still a draft and has
> open defects and verification work. See [tasks.md](tasks.md).

The design rationale and later phases remain in [index.html](index.html),
[plan.html](plan.html), and the other pages in this folder. The implementation-level bridge
contract currently lives on PR #6972 as `contracts.md`. This file records the product contract
in the repository's `specs.md` format and separates what phase 1 requires from later work.

## Goal

Let an agent create a small HTML application in its drive and let a person run that application
beside the conversation. The application can read or edit files in its own folder after the
person grants access. It cannot receive the person's login, call the Agenta API directly, read a
sibling folder, or reach the network through the bridge.

Phase 1 proves the smallest useful loop:

1. The agent copies or writes an application folder.
2. The person opens its HTML entry file from the drive.
3. The person chooses **Run** and grants read or read and write access.
4. The application uses `window.agenta.fs` to work with files in its folder.
5. Changes made by the application appear in the drive, and changes made elsewhere are reported
   back to the running application.

## Application folder and manifest

A folder is an application when it contains a direct child named `app.json` whose parsed value
meets these rules:

- `agenta_app` is the number `1`.
- `name` is a non-empty string.
- `entry` is a bare filename in the application folder. It defaults to `index.html` and cannot
  contain `/`, `\`, or `..`.
- `access` is `read` or `read-write`. It defaults to `read`.
- `kit` is a boolean and defaults to `true`.
- `icon`, `template`, `data`, `config`, `refresh`, and `tools` are optional.
- Malformed optional fields are ignored. Unknown top-level fields are preserved as `extra`.

`refresh.prompt` and `tools` are reserved fields in phase 1. The parser accepts them, but Run
does not execute the prompt or expose those tools.

## Creation

Agents with a drive receive the `agenta-apps` skill and two platform operations:

- `list_starters()` returns bundled starters and valid agent-authored starter descriptions found
  under `agent-files/.apps/starters/`.
- `create_app(starter, dir, update=false)` copies a bundled starter into the requested relative
  drive folder and stamps the manifest's `template` field.

`create_app` refuses an existing `app.json` unless `update=true`. An update replaces template
files while preserving every file named by the live manifest's `data` field and its `config`
file. Agent-authored starters can be listed but cannot yet be copied by `create_app`.

The bundled phase 1 catalogue contains `board@1`. Its files use plain JSON so both the agent and
the application can understand and edit the same data.

## Run entry and grants

When the `agent-apps` user flag is enabled, an HTML file opened from the drive offers
**Source**, **Preview**, and **Run**. With the flag disabled, Run is absent and the existing drive
behavior remains.

Choosing Run for an application that has no suitable grant opens a grant sheet. The grant:

- names the application and its folder;
- offers read or read and write access, up to the access requested by the manifest;
- is keyed by mount, application folder, and level;
- lives in browser session storage;
- survives application file edits and ordinary reloads in that browser session;
- is not persisted in workspace layout data;
- is requested again when the manifest grows from `read` to `read-write`; and
- is forgotten by a new browser session.

The application never receives an authentication token. The parent page performs file calls on
the person's behalf and still applies the person's normal project permissions.

## Bridge protocol

Run assembles the entry document in a sandboxed iframe and installs `window.agenta` before the
application's scripts execute. The parent sends one `hello` message with a transferred
`MessagePort`. All later bridge traffic uses that port. Every message carries `v: 1`, and every
file request carries a numeric `id` that its response repeats.

`window.agenta` exposes:

- `version`, `ready`, `canWrite`, `dir`, and `visible`;
- `fs.read`, `readJSON`, `write`, `writeJSON`, `list`, `exists`, `stat`, and `remove`; and
- `visibilitychange`, `changed`, and `theme` events.

Bridge paths are relative to the application folder, use `/`, and have no leading slash.
`list("")` lists the application folder itself. Every other method rejects an empty path.
Absolute paths, traversal, backslashes, control characters, and encoded dot traversal are
rejected with `scope`.

Bridge failures use these stable codes: `scope`, `read_only`, `not_found`, `conflict`,
`too_large`, `unavailable`, and `bad_request`. A conflict also carries the server's current
entity tag (ETag), or `null` when the file no longer exists.

## Folder boundary

The browser resolves every requested path against the application folder before making an API
call. The server also enforces the folder boundary with a signed, short-lived scope token.

The token binds the project, mount, folder prefix, grant level, and expiry. Every bridge file
call sends it in `X-Agenta-App-Scope`. The mount route first applies the person's normal project
permission and then narrows that permission to the token's mount, prefix, and level. A token can
never widen access. Ordinary drive calls without a token keep their existing behavior.

The server must apply the prefix to reads, writes, deletes, stats, and listings. A scoped listing
with no explicit path must list the token prefix, not the mount root. The current implementation
does not yet meet this last requirement. It is a required fix in [tasks.md](tasks.md).

## File behavior and conflicts

Files are UTF-8 text. Reads are limited to 4 MB and writes to 1 MB. Larger operations return
`too_large`.

The host remembers the ETag returned by a read, list, stat, or successful write. The next write
or remove for that path sends the remembered value as `If-Match`. A `412` response becomes a
`conflict` bridge error. Re-reading refreshes the cached ETag. `{force: true}` deliberately skips
`If-Match` and overwrites the current value. A file the application has not read is written
without a precondition.

The mount API performs a native conditional put for writes. Conditional delete is implemented as
stat, compare, then delete because the supported object stores do not share a portable
conditional-delete operation. A write that lands between the comparison and delete can be
deleted without detection. This race is a known phase 1 limitation.

Agent file tools remain unconditional in phase 1. The agent skill tells the agent to read a data
file before writing it. Conditional agent writes are later work.

## External changes

When the drive reports that files changed outside the application, the host sends a `changed`
event with application-relative paths. The event is a hint. It does not clear the host's ETag
cache. An application that re-reads after the event refreshes its ETag; an application that does
not re-read receives a conflict on its next conditional write.

After a successful application write or remove, the host revalidates the drive listing. Theme
changes and visibility changes are sent without rebuilding the iframe.

## Run isolation

The Run iframe uses `sandbox="allow-scripts allow-forms"`. It omits `allow-same-origin` and
popup permissions. Its content security policy allows inline scripts and styles, data or blob
images, and data fonts. It denies network connections, external resources, and form submission.
The bridge stub also neutralizes WebRTC constructors before application code runs.

The server-side folder token is the trusted data boundary. Browser restrictions reduce ways an
application can send its permitted folder data elsewhere, but the design does not treat an
enumerated browser blocklist as proof that every future browser exit is closed.

Preview is separate from Run. Preview removes application scripts and has no bridge. It retains
normal preview navigation behavior, but its content security policy denies connections, frames,
and objects. It can still render external styles, images, and fonts over HTTPS.

## Navigation, assembly, and design kit

Run inlines same-folder styles, scripts, images, and other supported assets into the assembled
document. Any reference that leaves the application folder prevents Run. In-folder HTML links
are reported to the host and reassembled in the same Run view under the same grant. External
navigation is reported to the host for a product decision and is never opened directly by the
application.

When `kit` is not `false`, the host injects the phase 1 design kit. The kit contains the
documented `--ag-*` theme tokens and `.ag-*` component classes. It contains no remote URLs,
imports, or fonts. A theme switch updates the tokens inside the running application.

## Agent-level records

The `agenta-apps` skill reserves `agent-files/.apps/` for durable application records, starter
descriptions, and repeated-feedback notes. Each session writes only its own registry file. Reads
merge registry records by slug using the later `updated_at`; the current session wins an exact
timestamp tie. The merge is a read operation and must not rewrite another session's registry.

Application data never belongs under `.apps/`. Application files remain in the session drive.
The skill describes this lifecycle, but phase 1 does not add a server-side registry service.

## Phase 1 acceptance

Phase 1 is complete only when all of these hold on both desktop and `/m` hosts:

- A drive HTML file offers Run only when the feature flag is enabled.
- Read and read-write grants behave as shown and survive only for the browser session.
- The board starter reads, writes, reloads, and reconciles concurrent changes without silent
  overwrite.
- The API rejects every scoped request outside the granted folder, including a pathless list.
- Read-only mode never sends a write and can reconcile an external change.
- In-folder navigation stays in Run; out-of-folder markup prevents Run.
- The iframe restrictions block the tested HTTP, navigation, form, nested-frame, object, and
  WebRTC exits.
- Theme and visibility changes reach the application.
- The agent can list starters, create `board@1`, read a user change on the next turn, and update a
  starter without replacing its data.
- The Storybook stories and focused API and web tests pass, and repository format and lint checks
  are clean.

## Later work

The following items are designed but are not part of the phase 1 contract:

- a two-pane workspace and persisted non-session tabs;
- manifest folders rendered as application tiles;
- `window.agenta.user`, location state, composer drafts, asset preload, and one-click error send;
- a Refresh action that asks the agent or shows a schedule;
- the remaining standard starters and the canvas library shelf;
- copying and promoting agent-authored starters;
- conditional file writes from agent tools;
- model calls or proxied platform tools from an application;
- two live sessions plus an application in separate panes; and
- file-version browsing and restore.

Open platform questions remain outside this feature: whether `agent-files/` travels with an
agent duplicate, what happens to the agent mount on deletion, and the performance budget for two
streaming sessions plus a running application.
