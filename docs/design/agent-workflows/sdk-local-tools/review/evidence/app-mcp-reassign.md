# Evidence – F-006

`services/oss/src/agent/app.py:91-92`
```python
    resolved = await resolve_tools(agent_config.tools)
    resolved.mcp_servers = await resolve_mcp_servers(agent_config.mcp_servers)
```

`resolve_tools` already returns mcp_servers empty by construction:

`services/oss/src/agent/tools.py:147-158` (docstring + body) returns `ResolvedTools()` /
`ResolvedTools` whose `mcp_servers` defaults to `[]`; the function never populates it. Relevance:
the overwrite is redundant and relies on an implicit "resolve_tools never sets mcp_servers"
contract; info-level readability/coupling note only.
