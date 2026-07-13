# Pre-production migration

## Policy

Use the pre-production window to remove the bad public shape now. Do not carry indefinite dual
write or preserve stdio as a first-class author option.

The migration has one compatibility boundary so existing development revisions fail clearly or
upgrade deterministically. New saves and all public documentation use version 2 only.

## Version 1 mapping

| Version 1 | Version 2 |
| --- | --- |
| `name` | `name` |
| `transport: "http"` | `connection.type: "remote_http"` |
| `url` | `connection.url` |
| HTTP `env` | `connection.headers` |
| `secrets` | `connection.credentials.type: "header_secret_refs"` and `headers` |
| `tools: []` | `policy.tools.mode: "all"` |
| non-empty `tools` | `policy.tools.mode: "include"` and `names` |
| `permission` | `policy.permission` |

Version 1 stdio has no version 2 mapping. It receives a clear unsupported validation error.

## Migration mechanism

1. Inventory saved revisions containing `agent.mcps` in pre-production databases.
2. If the inventory is disposable, reset those drafts and remove version 1 parsing immediately.
3. If the inventory must be retained, run an explicit data migration for version 1 HTTP entries.
4. Reject version 1 stdio entries and report their revision identifiers for manual cleanup.
5. Keep a read-only v1 decoder for one release only if external API callers already depend on it.
6. Remove the decoder after telemetry shows no v1 calls.

Do not normalize and rewrite a saved revision during invocation. Runs should be deterministic and
must not mutate author state.

## Rollback

The feature capability remains off by default. A rollback disables editing and execution without
rewriting saved version 2 configs. Because the author contract is independent of direct versus
gateway delivery, a runtime rollback does not require a schema rollback.

