# Evidence – F-001

Gateway specs get the orthogonal axes via `attach_orthogonal` at the end of the gateway remap:

`services/oss/src/agent/tools.py:131-138`
```python
        entry = {
            "name": name,
            "description": spec.get("description"),
            "inputSchema": spec.get("input_schema"),
            "callRef": call_ref,
            "kind": "callback",
        }
        custom_tools.append(attach_orthogonal(entry, tool))
```

The integration fixture has no orthogonal fields, so this branch never runs with the axes set:

`services/oss/tests/pytest/integration/agent/test_resolve_tools_http.py:22`
```python
_GATEWAY = {"function": {"name": "tools__composio__github__GET_USER__c1"}}
```

A grep for `needs_approval|needsApproval|render` combined with `gateway|composio|callback` in
the gateway test files returns nothing — only the local code/client path asserts carry-back
(`test_tool_refs.py` / `test_tool_resolution.py`, the `pick` client tool). Relevance: the
gateway branch of `attach_orthogonal` is unexercised, so an approval-drop regression on
server-side tools ships green.
