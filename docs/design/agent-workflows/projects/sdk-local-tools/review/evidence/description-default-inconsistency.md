# Evidence – F-004

SDK builders default description to the tool name:

`sdks/python/agenta/sdk/agents/tool_resolution.py:99-108`
```python
def code_tool_spec(tool: CodeToolDef, env: Dict[str, str]) -> Dict[str, Any]:
    entry: Dict[str, Any] = {
        "name": tool.name,
        "description": tool.description or tool.name,
        ...
```

Gateway remap copies the backend field, which may be None:

`services/oss/src/agent/tools.py:131-133`
```python
        entry = {
            "name": name,
            "description": spec.get("description"),
```

Runner absorbs a None description downstream:

`services/agent/src/engines/pi.ts:162` -> `description: spec.description ?? spec.name`
`services/agent/src/tools/mcp-server.ts:67` -> `description: s.description ?? s.name`

Relevance: same "no description" condition yields `name` for code/client but `None` for gateway
on the wire; harmless at runtime, inconsistent on the contract.
