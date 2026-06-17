# Harness + Runtime port redesign

Status: research and proposal, scope approved (full A to E arc, cold per invoke). Not
implemented. Read this, then [`research.md`](research.md) (the side by side), then
[`proposal.md`](proposal.md) (the recommended port shape), then [`plan.md`](plan.md) (the
phased build), with [`status.md`](status.md) holding decisions and open questions.

## Why this exists

WP-8 adopted [`rivet-dev/sandbox-agent`](https://github.com/rivet-dev/sandbox-agent)
unmodified and kept our `Harness` and `Runtime` ports unchanged on purpose (see
[`../wp-8-rivet-acp-runtime/`](../wp-8-rivet-acp-runtime/README.md)). That shipped, but
it also exposed how thin our ports are next to rivet's SDK. Our `Harness.invoke()`
takes a request and returns one string. Rivet's SDK models sessions, a live structured
event stream, per harness capabilities, multimodal input, permissions, and an explicit
lifecycle.

This folder compares the two interfaces and proposes how to evolve our ports so they
borrow rivet's vocabulary without giving up the neutral seam (rivet stays one adapter
behind the port, so the legacy Pi path and a future non-rivet harness still fit).

## The one screen summary

Rivet splits the surface into three planes. The split is the main lesson.

| Plane | Rivet owns it via | Belongs in our port? |
| --- | --- | --- |
| Runtime / sandbox (where the daemon runs, lifecycle) | `SandboxAgent` + providers (`local`, `daytona`, `e2b`, `docker`, ...) | Yes, as the environment seam |
| Agent session (prompt, config, events, permissions) | `Session` (`prompt`, `onEvent`, `setModel`, ...) | Yes, this is the heart of the port |
| System (filesystem, process, desktop) | `SandboxAgent.readFsFile` / `runProcess` / `clickDesktop` ... | No. Provisioning only, never exposed to the config author |

Our current `Harness` port collapses the first two planes into a single blocking
`invoke()` and ignores most of what the session plane offers.

## Verdicts on the proposed scope

The starting hypothesis was: sessions, skills, tools, hooks, and attachments belong in
the port; system (filesystem) does not; streaming and session destroy are worth adopting.
Mostly right. The corrections:

- **Sessions** — adopt. Make a session a first class object with create, continue,
  destroy, and a pluggable persistence driver, the way rivet does. Today a session is
  just a `session_id` string and the history is replayed as prompt text.
- **Skills** — adopt, but as config artifacts laid into the workspace, not a new verb.
  Rivet exposes `setSkillsConfig(directory, ...)`; the harness reads them from disk.
- **Tools** — adopt and generalize. WP-7 already passes tools as `custom_tools` plus a
  callback. Make delivery capability gated (MCP vs native) instead of `if harness == pi`.
- **Hooks** — **correction.** Rivet has no hook API. Hooks are a harness level concept
  (Pi and Claude read them from their own config dirs). Model them as part of the agent
  config bundle laid into the workspace, not as a port method rivet would host.
- **Attachments** — adopt. Rivet prompts take ACP content blocks (text, image, audio,
  resource, resource_link). Our prompt is a bare string, so images and files cannot pass.
- **System (filesystem etc.)** — correct, keep it out of the `Harness` port. It is part
  of the runtime/sandbox provider surface and we already use `writeFsFile`/`mkdirFs` only
  to provision (upload AGENTS.md, auth, the extension) on Daytona.
- **Communication / streaming** — adopt. Replace the one shot string return with a
  structured event stream plus a final result, so tracing, multi message output, and
  client streaming all read from one source.
- **Destroy / lifecycle** — adopt. Rivet has `destroySession`, `destroySandbox`,
  `pauseSandbox`, `killSandbox`, `dispose`. Our `Runtime.pause` is a no-op stub.

## What this does not propose

A rewrite. The recommendation is a phased evolution (see [`proposal.md`](proposal.md))
that keeps `/invoke` and `/inspect` working at every step and leaves rivet behind the
port. The folder jail, multi tenant isolation, and the warm shared daemon stay deferred
to [`../wp-8-rivet-acp-runtime/isolation-and-fork.md`](../wp-8-rivet-acp-runtime/isolation-and-fork.md).
