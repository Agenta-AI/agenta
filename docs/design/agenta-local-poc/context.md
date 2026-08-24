# Context

## What users experience today

Agenta can run locally through the OSS Docker Compose deployment, but that deployment
starts the same platform architecture used for a multi-user server. It includes the web
application, API, workers, workflow service, runner, PostgreSQL, two Redis instances,
SuperTokens, object storage, migrations, and a reverse proxy. A person who only wants to
configure and run an agent on one computer receives the operational cost of the full
platform.

Claude, ChatGPT, and Hermes set a different expectation. A user installs an application,
opens it, and starts working. Local system access happens on that computer. Account and
team features come from the cloud when the user chooses them.

## Product hypothesis

A useful local Agenta does not need to reproduce self-hosted Agenta. It needs one local
user, one implicit project, agent configuration, immutable revisions, model credentials,
streaming conversations, and durable local history. Existing Agenta Cloud remains the
place for organizations, collaboration, evaluations, shared observability, and hosted
execution.

The POC should answer one question:

> Can Agenta provide a useful local agent workflow from one install, without Docker or
> the platform databases, while preserving a clear path to the existing cloud product?

## Target user journey

1. The user installs or unpacks Agenta Local on one supported operating system.
2. The user launches one command or application without installing Docker, Python, Node,
   PostgreSQL, or Redis.
3. The application opens a local Agenta window or browser page.
4. The user configures one model provider credential.
5. The user creates an agent with a name, instructions, provider, and model.
6. The user sends a message and sees streamed text.
7. The user quits, reopens the application, and resumes the same conversation.
8. The user can open Agenta Cloud when collaboration or evaluations are needed.

## POC goals

- Run without Docker and without externally installed databases.
- Bind every local network listener to loopback.
- Reuse the production agent SDK, runner wire contract, and Pi harness.
- Store agents, revisions, sessions, and messages in SQLite.
- Keep provider credentials outside SQLite and out of renderer storage.
- Present a narrow Agenta-branded agent editor and conversation UI.
- Produce one distributable bundle for the first target operating system.
- Keep local and cloud state separate by default.
- Deny every Pi built-in tool until a later design provides an enforceable filesystem
  boundary.

## POC non-goals

- Replacing the OSS self-hosted product.
- Organizations, members, invitations, RBAC, billing, or entitlements.
- Evaluations, test sets, annotations, trace exploration, or dashboards.
- Multiple local projects or multiple local users.
- Automatic local-to-cloud synchronization or conflict resolution.
- Cloud account login inside the local renderer.
- Cloud-managed local runners.
- Warm runner sessions, resumable approvals, attachments, or durable remote mounts.
- Claude Code and Codex harness packaging.
- Electron, production-grade auto-update, signing, notarization, or Windows support.

## POC target

Target Linux first because the current development environment and local runner path are
available there. The runtime design must avoid Linux-only assumptions where practical,
but cross-platform installers are productization work, not POC acceptance criteria.

## Decision after the POC

Proceed toward a product only if the POC demonstrates all three outcomes:

1. A clean machine can install and launch it without platform infrastructure.
2. The existing SDK and runner execute useful local conversations without calling Agenta
   Cloud or the full API.
3. The local product surface feels coherent enough that users do not expect the missing
   multi-user platform pages.
