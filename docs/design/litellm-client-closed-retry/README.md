# LiteLLM Client Closed Retry Workaround

## Problem

Production chat endpoint intermittently fails with "OpenAIException - Connection error" when the underlying httpx client is closed mid-request due to LiteLLM's cache eviction.

## Workspace Contents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background, problem statement, root cause analysis |
| [research.md](./research.md) | Code analysis, LiteLLM internals, findings |
| [plan.md](./plan.md) | Execution plan for the workaround |
| [status.md](./status.md) | Current progress and decisions |

## Quick Summary

- **Issue**: Chat endpoint returns 500 with "Cannot send a request, as the client has been closed"
- **Root Cause**: LiteLLM caches OpenAI clients; when evicted mid-request, GC closes the httpx client
- **Workaround**: Detect error in exception chain, flush cache, retry once
- **Affected**: Only OpenAI models, only in production (high concurrency)
