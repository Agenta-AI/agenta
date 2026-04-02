import json
from typing import Any, Optional

import click
from sqlalchemy import Connection, text

from agenta.sdk.engines.running.utils import infer_url_from_uri, parse_uri


REVISION_FLAG_KEYS = (
    "is_managed",
    "is_custom",
    "is_llm",
    "is_hook",
    "is_code",
    "is_match",
    "is_feedback",
    "is_chat",
    "has_url",
    "has_script",
    "has_handler",
)


def _normalize_artifact_flags(
    legacy_flags: Optional[dict[str, Any]],
) -> dict[str, bool]:
    is_evaluator = bool((legacy_flags or {}).get("is_evaluator", False))

    return {
        "is_application": not is_evaluator,
        "is_evaluator": is_evaluator,
        "is_snippet": False,
    }


def _normalize_revision_flags(
    *,
    legacy_flags: Optional[dict[str, Any]],
    data: Optional[dict[str, Any]],
) -> dict[str, bool]:
    legacy_flags = legacy_flags or {}
    data = data or {}

    uri = data.get("uri") if isinstance(data, dict) else None
    url = data.get("url") if isinstance(data, dict) else None
    script = data.get("script") if isinstance(data, dict) else None

    provider, kind, key, _version = parse_uri(uri) if uri else (None, None, None, None)

    if not url and uri:
        url = infer_url_from_uri(uri)

    return {
        "is_managed": provider == "agenta",
        "is_custom": kind == "custom",
        "is_llm": key == "llm",
        "is_hook": key == "hook",
        "is_code": key == "code",
        "is_match": key == "match",
        "is_feedback": key in {"feedback", "trace"}
        or bool(legacy_flags.get("is_feedback") or legacy_flags.get("is_human")),
        "is_chat": bool(legacy_flags.get("is_chat", False) or key == "chat"),
        "has_url": bool(url),
        "has_script": bool(script),
        "has_handler": False,
    }


def upgrade_workflow_revisions(session: Connection) -> None:
    """Backfill workflow entities to the new flag ownership model.

    Phase 1 — No-URI rows: backfill URI based on flags/URL presence.
    Phase 2 — Existing-URI rows: normalize data fields.
    Phase 3 — Rebuild flags:
      - artifacts keep only role/discovery flags
      - variants drop flags entirely
      - revisions keep only revision-level flags with all keys explicit

    Convention:
      - data column is json; cast to jsonb for mutation, back to json for storage.
      - role flags are no longer stored on revisions.
      - '-' removes a key (safe if absent).
      - '||' merges/overwrites at top level.
      - Legacy script dict {"runtime","content"} is flattened to top-level
        runtime + string script.
    """

    # ----------------------------------------------------------------
    # Phase 1: No-URI rows — backfill URI
    # ----------------------------------------------------------------

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')
          || '{"uri": "agenta:builtin:hook:v0"}'::jsonb
        )::json
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND data::jsonb ->> 'url' IS NOT NULL
          AND flags->>'is_custom' = 'true'
          AND flags->>'is_evaluator' = 'false'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'runtime' - 'parameters' - 'service' - 'configuration')
          || '{"uri": "agenta:custom:feedback:v0"}'::jsonb
        )::json
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND COALESCE(flags->>'is_feedback', flags->>'is_human') = 'true'
          AND COALESCE(flags->>'is_custom', 'false') = 'false'
          AND COALESCE(flags->>'is_chat', 'false') = 'false'
          AND flags->>'is_evaluator' = 'true'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'runtime' - 'parameters' - 'service' - 'configuration')
          || '{"uri": "agenta:custom:feedback:v0"}'::jsonb
        )::json
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND COALESCE(flags->>'is_feedback', flags->>'is_human', 'false') = 'false'
          AND COALESCE(flags->>'is_custom', 'false') = 'true'
          AND COALESCE(flags->>'is_chat', 'false') = 'false'
          AND flags->>'is_evaluator' = 'true'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
          || '{"uri": "agenta:builtin:chat:v0"}'::jsonb
        )::json
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND flags->>'is_chat' = 'true'
          AND flags->>'is_evaluator' = 'false'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
          || '{"uri": "agenta:builtin:completion:v0"}'::jsonb
        )::json
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND flags->>'is_chat' = 'false'
          AND flags->>'is_evaluator' = 'false'
          AND flags->>'is_custom' = 'false'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'service' - 'configuration')
          || '{"uri": "user:custom:local:latest"}'::jsonb
          || CASE
               WHEN jsonb_typeof(data::jsonb -> 'script') = 'object' THEN
                 jsonb_build_object(
                   'runtime', data::jsonb -> 'script' -> 'runtime',
                   'script',  data::jsonb -> 'script' -> 'content'
                 )
               WHEN data::jsonb -> 'script' IS NOT NULL THEN
                 jsonb_build_object('script', data::jsonb -> 'script')
               ELSE '{}'::jsonb
             END
        )::json
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND flags->>'is_chat' = 'false'
          AND flags->>'is_custom' = 'true'
          AND flags->>'is_evaluator' = 'false'
          AND (NOT (data::jsonb ? 'schemas') OR jsonb_typeof(data::jsonb -> 'schemas') = 'null')
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
          || '{"uri": "agenta:builtin:chat:v0"}'::jsonb
        )::json
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND data::jsonb ->> 'url' IS NOT NULL
          AND flags->>'is_chat' = 'true'
          AND flags->>'is_custom' = 'false'
          AND flags->>'is_evaluator' = 'false'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
          || '{"uri": "agenta:builtin:completion:v0"}'::jsonb
        )::json
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND data::jsonb ->> 'url' IS NOT NULL
          AND flags->>'is_chat' = 'false'
          AND flags->>'is_custom' = 'false'
          AND flags->>'is_evaluator' = 'false'
    """)
    )

    # ----------------------------------------------------------------
    # Phase 2: Existing-URI rows — normalize data fields
    # ----------------------------------------------------------------

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'script' - 'service' - 'configuration')
          || CASE
               WHEN jsonb_typeof(data::jsonb -> 'script') = 'object' THEN
                 jsonb_build_object(
                   'runtime', data::jsonb -> 'script' -> 'runtime',
                   'script',  data::jsonb -> 'script' -> 'content'
                 )
               WHEN data::jsonb -> 'script' IS NOT NULL THEN
                 jsonb_build_object('script', data::jsonb -> 'script')
               ELSE '{}'::jsonb
             END
        )::json
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' LIKE 'user:custom:%'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')::json
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:auto_webhook_test:v0'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'url' - 'headers' - 'script' - 'service' - 'configuration')
          || CASE
               WHEN jsonb_typeof(data::jsonb -> 'script') = 'object' THEN
                 jsonb_build_object(
                   'runtime', data::jsonb -> 'script' -> 'runtime',
                   'script',  data::jsonb -> 'script' -> 'content'
                 )
               WHEN data::jsonb -> 'script' IS NOT NULL THEN
                 jsonb_build_object('script', data::jsonb -> 'script')
               ELSE '{}'::jsonb
             END
        )::json
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:auto_custom_code_run:v0'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (data::jsonb - 'url' - 'headers' - 'script' - 'runtime' - 'service' - 'configuration')::json
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' LIKE 'agenta:builtin:%'
          AND data::jsonb ->> 'uri' NOT IN (
            'agenta:builtin:chat:v0',
            'agenta:builtin:completion:v0',
            'agenta:builtin:code:v0',
            'agenta:builtin:hook:v0',
            'agenta:builtin:auto_webhook_test:v0',
            'agenta:builtin:auto_custom_code_run:v0'
          )
          AND flags->>'is_evaluator' = 'true'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')::json
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (
          (data::jsonb - 'url' - 'headers' - 'script' - 'service' - 'configuration')
          || CASE
               WHEN jsonb_typeof(data::jsonb -> 'script') = 'object' THEN
                 jsonb_build_object(
                   'runtime', data::jsonb -> 'script' -> 'runtime',
                   'script',  data::jsonb -> 'script' -> 'content'
                 )
               WHEN data::jsonb -> 'script' IS NOT NULL THEN
                 jsonb_build_object('script', data::jsonb -> 'script')
               ELSE '{}'::jsonb
             END
        )::json
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:code:v0'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')::json
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0'
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET data = (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')::json
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0'
    """)
    )

    # ----------------------------------------------------------------
    # Phase 3: Rebuild flags for artifact / variant / revision ownership
    # ----------------------------------------------------------------

    session.execute(
        text("""
        UPDATE workflow_artifacts
        SET flags = jsonb_build_object(
          'is_evaluator', COALESCE((flags->>'is_evaluator')::boolean, false),
          'is_application', NOT COALESCE((flags->>'is_evaluator')::boolean, false),
          'is_snippet', false
        )
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_variants
        SET flags = NULL
    """)
    )

    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = NULL,
          flags = NULL
        WHERE version = '0'
    """)
    )

    revision_rows = session.execute(
        text("""
        SELECT project_id, id, data, flags
        FROM workflow_revisions
        WHERE version IS NULL OR version <> '0'
    """)
    ).mappings()

    for row in revision_rows:
        revision_flags = _normalize_revision_flags(
            legacy_flags=row["flags"],
            data=row["data"],
        )

        session.execute(
            text("""
            UPDATE workflow_revisions
            SET flags = CAST(:flags AS jsonb)
            WHERE project_id = :project_id
              AND id = :id
        """),
            {
                "project_id": row["project_id"],
                "id": row["id"],
                "flags": json.dumps(revision_flags),
            },
        )

    click.echo(
        click.style(
            "Successfully backfilled workflow artifact, variant, and revision flags.",
            fg="green",
        ),
        color=True,
    )


def downgrade_workflow_revisions(session: Connection) -> None:
    """Downgrade is not supported.

    This migration destructively replaces flags and strips JSONB keys from
    workflow revisions. The original values cannot be restored.
    """

    raise NotImplementedError(
        "Downgrade is not supported: this migration destructively replaces "
        "flags and strips legacy JSONB keys. Restore from backup if needed."
    )
