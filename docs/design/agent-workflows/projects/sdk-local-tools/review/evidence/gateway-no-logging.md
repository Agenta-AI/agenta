# Evidence – F-002

`services/oss/src/agent/tools.py:97-107`
```python
    async with httpx.AsyncClient(timeout=TOOLS_TIMEOUT) as client:
        response = await client.post(
            f"{api_base}/tools/resolve",
            json={"tools": refs},
            headers=headers,
        )
    if response.status_code >= 400:
        raise ToolResolutionError(
            f"Tool resolution failed (HTTP {response.status_code}): {response.text[:500]}",
            status=response.status_code,
        )
```

No `try/except` around the POST: a transport error raises a raw `httpx` exception (not
`ToolResolutionError`). No `log.*` on any branch in `_resolve_gateway`.

Contrast the established pattern in the adjacent (out-of-scope) secret resolver:

`services/oss/src/agent/secrets.py:94-111`
```python
    try:
        async with httpx.AsyncClient(timeout=TOOLS_TIMEOUT) as client:
            response = await client.post(...)
        if response.status_code >= 400:
            log.warning("agent: named-secret resolve HTTP %s for %s", response.status_code, names)
            return {}
    except Exception:  # pylint: disable=broad-except
        log.warning("agent: named-secret resolve failed for %s", names, exc_info=True)
        return {}
```

Relevance: the gateway path neither logs failures nor normalizes transport errors to the typed
error, breaking the "fail-fast raises a typed `ToolResolutionError`" invariant for the
transport-failure case.
