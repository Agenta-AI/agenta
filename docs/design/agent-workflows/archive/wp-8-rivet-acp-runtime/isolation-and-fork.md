# Isolation and when a fork is needed

This is deferred for WP-8. It matters only if a later phase runs **one warm daemon hosting
many agents at once**. The WP-8 model (one daemon and one sandbox per invoke) avoids it: a
single agent owns its sandbox, so there is nothing to isolate it from. Read this only when
you move to a shared warm daemon, or when you want many agents inside one long-lived
sandbox each confined to its own folder.

Note on language: a "fork" here can mean two different things. The **jail** below is new
code we add. Separately, the tracing discussion mentioned forking an ACP **adapter**;
those are small TypeScript packages, not the Rust daemon. Neither is needed for WP-8.

## The gap

Rivet has no filesystem isolation (see [`research.md`](research.md#filesystem-no-jail-exists)).
A session's `cwd` is advisory and the file API resolves absolute paths verbatim. So if many
agents share one daemon, each can read and write the whole host, including other agents'
folders. Confining them to their own folders is then the load-bearing new capability.

## What rivet gives for free vs what we build

| Capability | Status in rivet |
| --- | --- |
| One daemon, many agents/sessions | done (`AcpProxyRuntime` instance map) |
| Multiple harnesses incl. Pi | done (`AgentId`, ACP adapters) |
| Per-session working directory | done (`cwd` plumbed end to end) |
| Per-directory tool config | done (MCP / skills) |
| HTTP + SSE streaming | done |
| **Folder jail (the agent sees only its folder)** | **missing; we add it (needs a fork)** |

## How the jail would work (deferred)

The field has converged on this for confining a coding agent to one folder without a
container per agent:

- **Linux, preferred:** bubblewrap (mount namespace, bind-mount only the folder so
  nothing else exists) + Landlock (VFS-level deny as a backstop) + seccomp (trim escape
  syscalls). This is what Codex CLI and Anthropic's `srt` do.
- **Caveat:** bubblewrap needs unprivileged user namespaces, which are disabled on
  hardened or managed distros. Fallback is **Landlock-only**: no root, no namespaces,
  still confines file access, but outside paths stay visible (EACCES on access) rather
  than invisible. Detect user namespaces at startup and degrade gracefully.
- **macOS:** no Landlock or namespaces. Use `sandbox-exec` / Seatbelt with a
  `(deny default)(allow file-* (subpath "<folder>"))` profile.
- Do not rely on the harness: opencode and Pi do no FS sandboxing; they trust the caller.

Threat model sets the bar. For self-hosted single-org, Landlock plus per-session `cwd` is
likely enough, which also sidesteps the user-namespace problem. For multi-tenant cloud,
you want the full bubblewrap + seccomp stack or genuine containers.

## Where the fork would touch rivet

If and when we add the jail, the changes are localized (paths inside the rivet repo):

1. **Subprocess confinement** — wrap the harness launch with bwrap / a Landlock helper.
   Easiest at the generated launcher in `agent-management/src/agents.rs` (`write_launcher`),
   threading a per-instance root through `acp_proxy_runtime.rs::create_instance` and
   `acp-http-adapter/src/process.rs` (`AdapterRuntime::start`, which today never even sets
   `current_dir`).
2. **File API jail** — `router/support.rs::resolve_fs_path`: add a configured root and
   reject absolute paths outside it.
3. **Process runtime jail** — `process_runtime.rs`: same confinement, or the jail leaks
   via `/v1/process`.
4. **Config** — `cli.rs` + `daemon.rs`: a `--root` / per-server root option (none exists).
5. (Optional) a TS provider that maps each agent to its own root folder, copying
   `providers/local.ts`.

Effort: the multi-agent / multi-harness / streaming half is inherited. The jail itself is
medium-to-large because it is platform-specific and has three escape surfaces with no
existing isolation code to build on. A soft jail (path-prefix checks + `cwd`, no kernel
enforcement) is small-to-medium but is not a real "cannot see outside" guarantee.

## Decision for now

Use rivet unmodified for WP-8 (ACP + harness swap + local, tools deferred). Fork only
when we need the jail, and keep the fork minimal and rebaseable against upstream.
