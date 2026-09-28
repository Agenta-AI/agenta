# Sharing agent HTML apps

A person can share an HTML app that an agent made in a session. The link works for workspace
members or for anyone who has it. Viewers see a frozen, read-only copy of the app on a
standalone page.

This folder plans the work. The parent design for HTML apps is in
[`../specs.md`](../specs.md) and [`../contracts.md`](../contracts.md).

## Reading order

| File | Answers |
|---|---|
| [context.md](context.md) | Why we build this, the agreed requirements, and what is out of scope. |
| [research.md](research.md) | How the code works today, with file and line evidence, and the confirmed bugs that affect sharing. |
| [design.md](design.md) | The data model, the token, the API routes, the share page, and the security rules. |
| [plan.md](plan.md) | The two changes to ship, in order, with their tasks and tests. |
| [status.md](status.md) | Current progress, decisions, and open questions. |

## Terms

- **App**: a drive folder that contains an `app.json` manifest. The agent writes it. There is
  no database table for apps.
- **Mount**: one row in the `mounts` table plus one object-store prefix. The drive shows a
  mount as a folder tree.
- **Session mount**: the mount named `cwd` that belongs to one session. Apps are created
  there (`create_app` in `api/oss/src/core/apps/handlers.py`).
- **Agent mount**: the mount the runner shows as `agent-files/`. It belongs to an agent, not
  a session.
- **Run mode**: the drive view that runs an app in a sandboxed iframe and gives it
  `window.agenta.fs`, a file bridge to its own folder.
- **Scope token**: the existing short-lived token that narrows a signed-in caller to one app
  folder (`api/oss/src/core/apps/scope_token.py`). It is not the share token.
- **Share token**: the new signed token inside a share link.
- **Snapshot**: the frozen copy of an app's files that a share link serves.
- **Version**: one snapshot. "Update share" makes a new version.
- **CSP**: Content Security Policy, the browser rule that decides what a page may load and
  where it may send data.
