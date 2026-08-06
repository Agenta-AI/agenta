# Evidence – F-003

`services/oss/src/agent/app.py:90-114`
```python
    msgs = to_messages(messages or (inputs or {}).get("messages") or [])
    resolved = await resolve_tools(agent_config.tools)        # can raise ToolResolutionError
    resolved.mcp_servers = await resolve_mcp_servers(agent_config.mcp_servers)

    session_config = SessionConfig(...)
    harness = make_harness(selection.harness, Environment(select_backend(selection)))

    if stream:
        return _agent_stream(harness, session_config, msgs)
```

Resolution runs before the `stream` branch, so a `ToolResolutionError` is raised by the `_agent`
coroutine itself — for the stream path that is the coroutine the endpoint awaits to *get* the
async generator, not a part yielded inside the stream. No test drives `_agent(stream=True)` with
a raising `resolve_tools`. Relevance: failure-path surfacing on `/messages` is unspecified and
unpinned; it may differ from the JSON path.
