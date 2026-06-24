# Context

## Why this exists

The agent config lets an author declare MCP servers. The contract already names two
transports — `stdio` (local child process) and `http` (remote URL) — but only `stdio` is
delivered to the runner. The inventory page
[`interfaces/in-service/mcp-models-and-resolution.md`](../../interfaces/in-service/mcp-models-and-resolution.md)
says *"Stdio servers run today; remote (`http`) servers are modeled but deferred."* and the
public-edge schema repeats the deferral.

In the PR #4821 review the author pushed back on the deferral twice:

- [3469961290](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469961290) on
  `agent-config-schema.md`: *"why is http deferred. cant you have a http mcp with token env as
  secrets? if so it might be easier to implement than stdio."*
- [3470094826](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3470094826) on
  `mcp-models-and-resolution.md`: *"why dont we have http? can we use secrets with http? how
  would the implementation look like. please spin off design docs for this feature with
  /plan-feature."*

This workspace is that spin-off. It is a **design doc, not an implementation** — it scopes the
work so a follow-up `implement-feature` can pick it up.

## Goals

1. Answer the reviewer concretely: yes, HTTP MCP can use named secrets, and it is plausibly
   simpler than stdio.
2. Show exactly where the deferral lives today and what flipping it on requires.
3. Specify the secret-injection path for HTTP: which secret goes where (header vs env), and
   how it stays out of the config and the logs.
4. Specify how it fits the existing MCP resolver and the `/run` wire — no new vault route, no
   new wire field beyond what `transport: "http"` + `url` already carry.

## Non-goals

- Implementing it. No code lands from this workspace.
- OAuth / dynamic-client-registration MCP auth. First cut is static bearer / API-key headers
  sourced from named vault secrets. OAuth is a later iteration.
- Changing the stdio path. Stdio stays exactly as is.
- Per-server tool-allowlist enforcement over ACP (already a known v1 gap, tracked separately).

## The two reviewer questions, restated

1. **Can HTTP MCP use secrets?** Yes — the same `secrets: {ENV_OR_HEADER: vault-secret-name}`
   map the stdio path uses. The only design choice is whether the resolved value is injected
   as an HTTP request header (the common case for a bearer token) or as a process env var
   (less relevant for a remote server the runner does not spawn).
2. **Is it easier than stdio?** Likely yes. Stdio has to launch and supervise a child process
   (`command`, `args`, often `npx -y ...`), pass scoped env to that process, and reason about
   process lifecycle. HTTP is a URL plus headers — no process, no bootstrap, no scoped-env
   plumbing. The harder part is purely auth-shape (header vs env, and later OAuth).
