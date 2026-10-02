# API and source contracts

These are proposed additions, not existing endpoints. Use `AgentTemplatesRouter`, typed FastAPI request/response models, injected domain behavior and existing permission/error conventions. Register fixed action routes before `/{key}`.

| Route | Operation | Contract |
| --- | --- | --- |
| POST `/agent-templates/query` | `query_agent_templates` | Optional search/category/author_id filters. Return `{count, templates}` from the bundled catalog, without pagination. |
| GET `/agent-templates/{key}` | `fetch_agent_template` | Optional version selector. Return `{template}` with normalized metadata, author, selected package version and internal source descriptor. |
| POST `/agent-templates/validate` | `validate_template` | Accept the same package sources as load. Return validation result and pin. Create no durable product objects. |
| POST `/agent-templates/load` | existing `load_agent_template` | Extend sources. Preserve base_revision, initial_message, connection choices, staging/attachment semantics, permissions and Idempotency-Key. Return 201 on creation and 200 on replay. |

Use the existing workflow-read permission for catalog reads. Load retains workflow-edit/session-run checks. Validate and load authorize every referenced session or attachment. Reuse the normal error envelope. Do not create a download route, a directory-validation route or a repository-scanning route.

## Proposed sources

- Internal: `{kind: "internal", key: "seo-assistant"}`. Preserve current catalog selection and package-pin behavior.
- Upload: `{kind: "upload", staging_session_id: "...", attachment_id: "..."}`. Reference bytes already held by the attachment service; never accept a server-local path from a client.
- Session file: `{kind: "session_file", session_id: "...", path: "templates/seo.zip"}`. Authorize the session and confine the path to its drive. Use the same archive resolver as upload. If existing services can expose both inputs as one immutable authorized file reference without new staging machinery, collapse these two transport DTOs before implementation. The two user workflows must remain supported.
- GitHub: `{kind: "github", repo_url: "https://github.com/owner/repo", commit: "<full-40-hex-commit-sha>", path: "packages/seo-assistant/1.0.0"}`. Require a public repository and exact package directory. Reject branch names, tags, abbreviated SHAs and a `ref` field. Never silently resolve or substitute them.

GitHub selection sends the PR head repository and head commit, not its merge commit or just its PR number. Fetch the selected directory at that commit. Record repository, commit, package path, package version and digest in provenance using the existing metadata conventions.

## Validation result

A valid result contains `valid: true`, `version`, `digest`, `supported_schema_versions`, and no issues. An invalid package returns `valid: false` with `issues: [{code, path, field, message, next_step}]`. File paths are package-relative. An issue can omit a field location when the failure concerns the whole archive. Never expose host paths.

Example: `ai.agenta/agents.json`, field `agents.seo.setup`, code `file_not_found`, message `The setup file does not exist`, next step `Create the referenced SETUP.md or correct this path`.

Authorization failures, missing sources and transport failures remain normal errors, not a successful validation result. The exported zip is validated after packaging; repairing files requires rebuilding and validating again. A local CI invocation may parse repository directories directly, but the remote API has no directory-only source.

## Pins and retries

Use the existing `TemplateSourcePin` version/digest representation where possible. Validate returns the pin; load can require it for mutable session-file paths. If a zip changes after validation, reject the stale pin rather than load different bytes. Upload attachment IDs must resolve immutable content or receive the same pin check.

The request fingerprint covers the full load command and stable source identity/pin, not just the content digest. Different initial messages or connection choices must not replay a prior request. Keep keys scoped to the project. Persist resolved provenance through the existing creation mechanism.

A completed request with the same key and identity replays its result even if the original remote source is unavailable. Conflicting requests return 409. Interrupted attempts retain the recorded pin and existing no-duplicate guarantees. Inspect the current loader before changing this flow; a stored digest alone is not evidence that the existing replay path avoids network access.

## Input limits

Preserve the current package bounds: 256 files, 4 MiB total uncompressed content, 1 MiB per file and 12 path segments. Set and test a separate compressed transfer bound. Reject unsafe archive paths, duplicates, symlinks, special entries and actual streamed content beyond the limits. Bound GitHub listing work and downloads. Neither source may execute package code during validation.
