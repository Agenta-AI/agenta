## Root cause of the "deployment codex-tool regression": it was slice D, not the deployment

The blocker above was misattributed. The deployment is healthy; the regression is a genuine code
bug in **slice D** (`6538514a`, `codex_settings.py`). Layer 3a/3b render approval-only
`[mcp_servers.<name>]` tables into `.codex/config.toml` — tables that declare **no transport**
(no `command`/`url`), because the servers they configure arrive via ACP `session/new`, not via
config. Codex validates every `mcp_servers` config entry at config load and rejects a
transport-less one, failing the whole session before any model or tool call:

```
$ CODEX_HOME=... codex exec "say hi"     # with only the slice D table present
Error loading config.toml: invalid transport
in `mcp_servers.agenta-tools`
```

codex-acp surfaces that as a JSON-RPC `-32603` on `session/new` (answered in 6ms), which
`acp-http-client` maps to the generic `Internal agent error: Internal error`.

### Evidence chain

1. **Daemon log** (`/root/.local/share/sandbox-agent/logs/log-07-24-26` in the runner container):
   every failing run ends at `method=session/new ... response_ms=6` (a 200 carrying a JSON-RPC
   error envelope); no `session/prompt` is ever sent. The internal tool MCP server binds fine
   first (`internal tool MCP server on http://127.0.0.1:37473/mcp serving 1 tool(s)`), and no
   api.openai.com traffic happens at all — the failure is pre-network, at config load.
2. **Recovered config**: the failing session's cwd is a geesefs mount flushed to seaweedfs, so the
   runner-written codex home survives. The filer shows
   `.codex/config.toml` = `[mcp_servers.agenta-tools.tools.list_connections]\napproval_mode = "approve"`
   — exactly slice D Layer 3b output for the QA tool.
3. **Single-variable flip**: an in-container driver (same `sandbox-agent` from `/app/node_modules`,
   same codex 0.145.0 + codex-acp 1.1.7, same `type:"http"` + Bearer-header MCP entry) runs a full
   MCP tool call green with no config.toml, and reproduces the exact
   `AcpRpcError: Internal agent error: Internal error` at `createSession` the moment the slice D
   TOML is written into `CODEX_HOME`. Direct-CLI probes: the Layer 3a shape
   (`[mcp_servers.x] default_tools_approval_mode = "approve"`) fails identically; the same tables
   WITH a `command` transport parse fine — which is why the spike's Q3 "parses cleanly" probe
   (run alongside a transport) missed this.
4. **Product-level proof**: temporarily suppressing the Layer 3 table emission in the bind-mounted
   SDK (services container restarted, nothing committed) turned `m3-qa.py allow` GREEN
   (tool executed, no pause, no errors) and `m2-qa.py chat` stayed green. The edit was reverted;
   the tree is back at the committed (still-blocked) state.

### Why every control experiment pointed the wrong way

- Slice D lives in the **SDK**, which the services container bind-mounts — so "loading the exact
  M2 runner code" only reverted the runner and still failed (the services side kept emitting the
  poison config.toml).
- Slice D was committed at 22:48:57 local, one minute before the 22:49 runner image rebuild — the
  correlation with container churn was pure coincidence, so rebuilds could never fix it.
- Baseline chat passes because a text-only Codex run derives no rules, so no config.toml is
  written; disabling slices A/B changed nothing because neither writes the file.
- Version drift was ruled out: codex-acp pinned 1.1.7; bundled `@openai/codex` 0.145.0 and
  `@agentclientprotocol/sdk` 1.3.0 have been npm `latest` since 07-21, and the whole stack
  (including the passing M2 QA) dates from today, so the passing and failing runs used identical
  artifact versions. The OpenAI key was independently verified live by the coordinator.

### The fix (not landed — owner's design call)

The verified fix is to stop emitting `[mcp_servers.*]` tables that carry no transport (in
`build_codex_settings_files`, the `server_tables`/`tool_tables` produced by
`_rules_from_mcp_permissions` / `_rules_from_tool_specs`). That deletes slice D's Layer 3
semantics as designed, so the design choice is the owner's: (a) drop Layer 3 config rendering
for ACP-delivered servers entirely (the runner-side slice B gate already enforces tool
permissions under the default mode), or (b) move the rendering to the runner, which knows the
internal server's loopback URL at session build time and could emit a transport-bearing entry
(a contract change: the runner stops being a blind `harnessFiles` writer). Layers 1/2 (scalar
`approval_policy` / `sandbox_mode`) are unaffected and valid.

Deployment state after this investigation: untouched and healthy (runner recreated once to the
same image; services restarted twice, second time back on committed code). Useful forensics:
codex's `$CODEX_HOME` lands on the geesefs mount and is recoverable after teardown via the
seaweedfs filer (`http://<filer>:8888/buckets/agenta-store/mounts/<project>/<session>/.codex/`);
the sandbox-agent daemon logs live at `~/.local/share/sandbox-agent/logs/` in the runner
container.
