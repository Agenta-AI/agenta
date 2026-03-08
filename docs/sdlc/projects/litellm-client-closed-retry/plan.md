# Execution Plan

## Approach: Retry Workaround

Since fixing the root cause requires changes to LiteLLM's caching logic (reference counting, in-use tracking), we'll implement a retry workaround at our SDK layer.

## Implementation

### Phase 1: Core Fix in mockllm.py

**File**: `sdk/agenta/sdk/litellm/mockllm.py`

**Changes**:

1. **Exception chain walker** - Function to iterate through `__cause__` and `__context__` chain
2. **Error detection** - Check if any exception in chain contains "client has been closed"
3. **Cache flush** - Clear `litellm.in_memory_llm_clients_cache` to remove stale clients
4. **Retry logic** - Retry once after flushing cache

**Why flush the cache?**
- The closed client might still be in cache (TTL not expired, just GC'd)
- Flushing ensures next attempt gets a fresh client
- Safe operation - just clears the dict, clients recreated on demand

**Code structure**:

```python
def _iter_exception_chain(exc: BaseException) -> Iterable[BaseException]:
    """Walk __cause__ and __context__ chain without cycles."""
    ...

def _has_closed_http_client_error(exc: BaseException) -> bool:
    """Check if 'client has been closed' appears anywhere in chain."""
    markers = (
        "Cannot send a request, as the client has been closed",
        "client has been closed",
    )
    for e in _iter_exception_chain(exc):
        if any(m in str(e) for m in markers):
            return True
    return False

def _flush_litellm_client_cache(litellm) -> None:
    """Clear cached clients to force fresh client creation."""
    cache = getattr(litellm, "in_memory_llm_clients_cache", None)
    if cache and hasattr(cache, "flush_cache"):
        cache.flush_cache()

async def acompletion(*args, **kwargs):
    ...
    max_retries = 2
    for attempt in range(max_retries):
        try:
            return await litellm.acompletion(*args, **kwargs)
        except Exception as e:
            if attempt < max_retries - 1 and _has_closed_http_client_error(e):
                log.warning("LiteLLM http client closed; flushing cache and retrying")
                _flush_litellm_client_cache(litellm)
                continue
            raise
```

### Phase 2: Cleanup Existing Retry Logic

**File**: `sdk/agenta/sdk/workflows/handlers.py`

There's duplicate retry logic in `auto_ai_critique_v0` that was added previously. This should be removed since the fix in `mockllm.py` covers all `acompletion` calls.

### Phase 3: Testing

Since we can't reproduce locally, testing strategy:

1. **Unit test** the helper functions (`_iter_exception_chain`, `_has_closed_http_client_error`)
2. **Deploy to staging** and monitor logs for retry warnings
3. **Monitor production** after deployment for:
   - Reduction in 500 errors on chat endpoint
   - Presence of "flushing cache and retrying" log messages

## Rollout

1. Merge to main
2. Deploy to staging environment
3. Monitor for 24-48 hours
4. Deploy to production
5. Monitor error rates and retry logs

## Success Criteria

- Chat endpoint 500 error rate returns to baseline
- Retry log messages appear occasionally (expected)
- No new failure modes introduced

## Future Work (Out of Scope)

If retry workaround proves insufficient:

1. **Upstream LiteLLM fix** - Contribute reference counting to their cache
2. **Disable client caching** - Check if LiteLLM has a config option
3. **Custom OpenAI client management** - Bypass LiteLLM's caching entirely
