# Context

## Problem Statement

The chat endpoint in production intermittently fails with the following error:

```json
{
  "detail": {
    "message": "litellm.InternalServerError: InternalServerError: OpenAIException - Connection error.",
    "stacktrace": [
      "...",
      "RuntimeError: Cannot send a request, as the client has been closed."
    ]
  }
}
```

### Observations

1. **Only affects OpenAI models** - other providers work fine
2. **Only in production** - cannot reproduce locally
3. **Only chat endpoint** - completion endpoint works (possibly different traffic patterns)
4. **Intermittent** - not every request fails

## Root Cause Analysis

### The Exception Chain

The error bubbles up through multiple layers:

```
httpx: RuntimeError("Cannot send a request, as the client has been closed")
  ↓
openai: APIConnectionError("Connection error")
  ↓
litellm: OpenAIError → InternalServerError
  ↓
agenta: Returns 500 to user
```

### Why It Happens

LiteLLM caches OpenAI clients (`AsyncOpenAI` instances) in an in-memory cache with TTL-based eviction.

**The race condition:**

1. Request A arrives, gets cached `AsyncOpenAI` client from `in_memory_llm_clients_cache`
2. Request A starts API call: `await litellm.acompletion(...)` (network I/O in progress)
3. While A is in-flight:
   - Cache TTL expires, OR
   - Cache reaches `max_size_in_memory`, triggers eviction
4. The client is removed from cache dict (but request A still holds a reference)
5. Python's garbage collector runs
6. The `httpx.AsyncClient` inside the evicted `AsyncOpenAI` gets `__del__` called, closing it
7. Request A's in-flight HTTP call fails: "client has been closed"

### Why Only Production?

- **Higher concurrency**: More concurrent requests = higher chance of race condition
- **Gunicorn workers**: `--max-requests 10000` causes worker recycling
- **GC pressure**: More objects = more frequent garbage collection
- **Cache pressure**: More requests = cache fills up faster, more evictions

### Why Only OpenAI?

LiteLLM uses different code paths for different providers:
- OpenAI path uses `AsyncOpenAI` client with internal httpx client
- The client caching is specific to the OpenAI integration in `litellm/llms/openai/openai.py`
- Other providers may create clients per-request or use different caching strategies

## Goals

1. **Immediate**: Make chat endpoint resilient to this failure mode
2. **User Impact**: Requests should succeed (with minimal latency increase from retry)
3. **Observability**: Log when retry happens for monitoring

## Non-Goals

1. **Fix LiteLLM's root cause** - that requires upstream changes to their caching logic
2. **Prevent the race condition entirely** - would need reference counting in LiteLLM's cache
3. **Handle other types of connection errors** - only targeting this specific failure mode

## Constraints

- Cannot modify LiteLLM source (we vendor a fork but want minimal divergence)
- Fix must be in our SDK layer (`agenta/sdk/litellm/mockllm.py`)
- Must not break other providers or introduce new failure modes
