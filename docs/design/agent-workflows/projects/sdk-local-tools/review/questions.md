# questions.md – Resolved Questions

| ID | Question | Context / Evidence | Provisional suggestions | Status |
|---|---|---|---|---|
| Q-001 | How is a `ToolResolutionError` raised by the `_agent` coroutine surfaced on the `/messages` SSE path versus the JSON `/invoke` path? | Failures before stream creation are protocol-level JSON errors. Failures after stream creation use SSE error parts. The routing layer now preserves the former. | Covered by routing and handler tests. | resolved |
| Q-002 | Does `/tools/resolve` guarantee response ordering matches request order, and can it echo a ref identity for key-based matching? | Ordering is no longer trusted. The existing resolved `call_ref` is normalized and used as the correlation key. | Covered by a reversed-response integration test. | resolved |
