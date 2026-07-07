# Evidence – F-005

`sdks/python/agenta/sdk/agents/tool_resolution.py:89-96`
```python
def attach_orthogonal(entry: Dict[str, Any], tool: Any) -> Dict[str, Any]:
    """Carry the orthogonal axes (approval, render) onto a wire spec when set."""
    if getattr(tool, "needs_approval", False):
        entry["needsApproval"] = True
    render = getattr(tool, "render", None)
    if render is not None:
        entry["render"] = render
    return entry
```

It is a public helper imported by the service:

`services/oss/src/agent/tools.py:36` -> `from agenta.sdk.agents.tool_resolution import (... attach_orthogonal)`

Mutates `entry` in place AND returns it. All current callers pass a fresh dict and use the
return value, so no live bug. Relevance: latent footgun for a future caller that passes a shared
dict; dual mutate-and-return contract is inconsistent with the package's other pure builders.
