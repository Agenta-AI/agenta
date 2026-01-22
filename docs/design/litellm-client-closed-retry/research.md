# Research

## LiteLLM Client Caching Internals

### Cache Structure

```
litellm.in_memory_llm_clients_cache  (LLMClientCache)
    └── extends InMemoryCache
        ├── cache_dict: dict          # key → client
        ├── ttl_dict: dict            # key → expiration_time
        └── expiration_heap: list     # min-heap for eviction
```

**Location**: `scripts/litellm/litellm/caching/in_memory_cache.py`

### Cache Key Generation

The cache key includes the event loop ID to prevent cross-loop issues:

```python
# scripts/litellm/litellm/caching/llm_caching_handler.py
class LLMClientCache(InMemoryCache):
    def update_cache_key_with_event_loop(self, key):
        event_loop = asyncio.get_running_loop()
        return f"{key}-{id(event_loop)}"
```

### OpenAI Client Creation

```python
# scripts/litellm/litellm/llms/openai/openai.py
def _get_openai_client(self, is_async, ...):
    # Check cache first
    openai_client = self.get_cached_openai_client(...)
    if openai_client is not None:
        return openai_client
    
    # Create new client with httpx client
    openai_aclient = AsyncOpenAI(
        api_key=api_key,
        http_client=OpenAIChatCompletion._get_async_http_client(shared_session),
        ...
    )
    
    # Cache it
    self.set_cached_openai_client(openai_aclient, ...)
    return openai_aclient
```

### HTTP Client Creation

```python
# scripts/litellm/litellm/llms/openai/common_utils.py
@staticmethod
def _get_async_http_client(shared_session=None):
    if litellm.aclient_session is not None:
        return litellm.aclient_session  # Global shared (not used by us)
    
    return httpx.AsyncClient(...)  # New client each time
```

### Cache Eviction

```python
# scripts/litellm/litellm/caching/in_memory_cache.py
def evict_cache(self):
    # Step 1: Remove expired items
    while self.expiration_heap:
        expiration_time, key = self.expiration_heap[0]
        if expiration_time <= current_time:
            heapq.heappop(self.expiration_heap)
            self._remove_key(key)  # Just removes from dict!
        ...
    
    # Step 2: Evict if cache is full
    while len(self.cache_dict) >= self.max_size_in_memory:
        expiration_time, key = heapq.heappop(self.expiration_heap)
        self._remove_key(key)  # No cleanup of the client!

def _remove_key(self, key):
    self.cache_dict.pop(key, None)  # Client now eligible for GC
    self.ttl_dict.pop(key, None)
```

**Critical insight**: `_remove_key` just removes from dict - it does NOT:
- Check if client is in use
- Gracefully close the client
- Wait for in-flight requests

### Cleanup at Exit

```python
# scripts/litellm/litellm/llms/custom_httpx/async_client_cleanup.py
async def close_litellm_async_clients():
    cache_dict = getattr(litellm.in_memory_llm_clients_cache, "cache_dict", {})
    for key, handler in cache_dict.items():
        if hasattr(handler, 'aclose'):
            await handler.aclose()

# Registered at import time
register_async_client_cleanup()  # atexit handler
```

## Production Configuration

### Gunicorn Settings (docker-compose.gh.yml)

```yaml
command: >
    newrelic-admin run-program gunicorn entrypoints.main:app
    --bind 0.0.0.0:80
    --worker-class uvicorn.workers.UvicornWorker
    --workers 2
    --max-requests 10000        # Worker recycled after 10k requests
    --max-requests-jitter 1000  # Random jitter to avoid thundering herd
    --timeout 60
    --graceful-timeout 60
```

### Cache Settings

```python
# scripts/litellm/litellm/caching/in_memory_cache.py
class InMemoryCache:
    def __init__(
        self,
        max_size_in_memory=200,     # Max 200 cached clients
        default_ttl=600,            # 10 minute TTL
        ...
    )
```

## Code Flow for Chat Endpoint

```
services/oss/src/chat.py
    └── chat() 
        └── chat_v0()  [sdk/agenta/sdk/workflows/handlers.py]
            └── mockllm.acompletion()  [sdk/agenta/sdk/litellm/mockllm.py]
                └── litellm.acompletion()
                    └── OpenAIChatCompletion.acompletion()
                        └── _get_openai_client()  # Cache lookup/create
                        └── openai_aclient.chat.completions.create()
                            └── httpx.AsyncClient.send()  # FAILS HERE
```

## Exception Chain Structure

When the error occurs, Python creates a chain:

```python
try:
    await httpx_client.send(request)
except RuntimeError as e:
    # e.message = "Cannot send a request, as the client has been closed"
    raise openai.APIConnectionError(...) from e

# Later in litellm:
except openai.APIConnectionError as e:
    raise litellm.InternalServerError(...) from e
```

The original `RuntimeError` is preserved in `__cause__` chain.

## Relevant GitHub Issues

- https://github.com/BerriAI/litellm/issues/13034 - Similar issue reported
