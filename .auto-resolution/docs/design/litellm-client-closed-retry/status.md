# Status

## Current State: In Progress

### Completed

- [x] Root cause analysis
- [x] Research LiteLLM caching internals
- [x] Design retry workaround
- [x] Implement fix in `mockllm.py`

### In Progress

- [ ] Clean up duplicate retry logic in `handlers.py`
- [ ] Format and lint
- [ ] Test deployment

### Pending

- [ ] Deploy to staging
- [ ] Monitor production

## Changes Made

### `sdk/agenta/sdk/litellm/mockllm.py`

Added:
- `_iter_exception_chain()` - Walks exception cause/context chain
- `_has_closed_http_client_error()` - Detects closed client error in chain
- `_flush_litellm_client_cache()` - Clears LiteLLM's client cache
- Retry logic in `acompletion()` - Catches error, flushes cache, retries once

### `sdk/agenta/sdk/workflows/handlers.py`

**TODO**: Remove duplicate retry logic in `auto_ai_critique_v0` (lines 1141-1175)

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-21 | Retry workaround vs upstream fix | Faster to ship, upstream fix requires LiteLLM changes |
| 2026-01-21 | Flush cache on retry | Ensures stale client is removed, safe operation |
| 2026-01-21 | Check exception chain not just top-level | Error wraps through multiple layers (httpx→openai→litellm) |
| 2026-01-21 | Max 2 attempts (1 retry) | Balance between reliability and latency |

## Open Questions

1. Should we add metrics/alerting for retry frequency?
2. Should we investigate LiteLLM config options to disable client caching?
3. Is there a way to reproduce this locally with artificial GC pressure?

## Blockers

None currently.
