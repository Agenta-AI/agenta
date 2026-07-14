# HTTP (remote) MCP transport

Index for the design workspace that turns the deferred `transport: "http"` MCP path into a
real, secret-aware feature. Spun out of PR #4821 review comments
[3470094826](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3470094826) and
[3469961290](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469961290): *"why is
http deferred? can't you have an http MCP with token env as secrets? if so it might be easier
to implement than stdio."*

## Files

- [context.md](context.md) — why this exists, goals, non-goals, the reviewer's two questions.
- [research.md](research.md) — the current MCP contract and resolver, where the deferral
  actually lives, and what the harnesses can already reach over HTTP.
- [plan.md](plan.md) — the proposed change: secret-to-header injection, the runner delivery
  flip, the wire, tests, and rollout.
- [status.md](status.md) — current state, decisions, open questions.

## One-paragraph answer to the reviewer

Yes. HTTP MCP is very likely *simpler* than stdio, because there is no child process to
launch, no `command`/`args`/`npx` bootstrap, and no per-process scoped-env handling. The
config and the SDK resolver **already model `transport: "http"`, `url`, and named `secrets`**
and already serialize them to the `/run` wire. The only thing deferred is **runner delivery**:
`toAcpMcpServers` skips every non-stdio server today. The real work is (1) decide whether a
named secret lands in an HTTP **header** (e.g. `Authorization: Bearer <token>`) or stays an
`env` value, (2) emit the ACP HTTP-MCP entry the harness expects (the bundled
`@zed-industries/claude-agent-acp` documents HTTP MCP with custom-header injection), and (3)
keep the secret out of the config and out of any logged payload. No new vault concept is
needed — it reuses the same named-secret resolution stdio already uses.
