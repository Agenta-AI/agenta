import click
from sqlalchemy import text, Connection


def upgrade_workflow_revisions(session: Connection) -> None:
    """Backfill URIs, normalize flags, and strip legacy fields on workflow_revisions.

    Phase 1 — No-URI rows: backfill URI based on flags/URL presence.
    Phase 2 — Existing-URI rows: normalize flags and strip legacy JSONB keys.

    Convention:
      - data column is json; cast to jsonb for mutation, back to json for storage.
      - flags column is jsonb; REPLACED entirely (not merged).
        Only role flags are persisted: is_evaluator, is_application, is_snippet.
        All other flags are inferred at commit/read time by infer_flags_from_data().
      - '-' removes a key (safe if absent).
      - '||' merges/overwrites at top level.
      - Legacy 'service' and 'configuration' are dropped.
      - Legacy script dict {"runtime","content"} is flattened to top-level
        runtime + string script.

    See docs/designs/runnables/migrations.sql for full analysis and row counts.
    """

    # ----------------------------------------------------------------
    # Phase 1: No-URI rows — backfill URI
    # ----------------------------------------------------------------

    # Row 5: No URI + URL + custom non-evaluator → hook:v0
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
            (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')
            || '{"uri": "agenta:builtin:hook:v0"}'::jsonb
          )::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND data::jsonb ->> 'url' IS NOT NULL
          AND flags->>'is_custom' = 'true'
          AND flags->>'is_evaluator' = 'false'
    """)
    )

    # Row 6: No URI + no URL + human non-custom evaluator → feedback:v0
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
            (data::jsonb - 'script' - 'runtime' - 'parameters' - 'service' - 'configuration')
            || '{"uri": "agenta:custom:feedback:v0"}'::jsonb
          )::json,
          flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb
    """)
    )

    # Row 7: No URI + no URL + non-human custom evaluator → feedback:v0
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
            (data::jsonb - 'script' - 'runtime' - 'parameters' - 'service' - 'configuration')
            || '{"uri": "agenta:custom:feedback:v0"}'::jsonb
          )::json,
          flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb
    """)
    )

    # Row 11: No URI + no URL + chat fallback → chat:v0
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
            (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
            || '{"uri": "agenta:builtin:chat:v0"}'::jsonb
          )::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND flags->>'is_chat' = 'true'
          AND flags->>'is_evaluator' = 'false'
    """)
    )

    # Row 12: No URI + no URL + completion fallback → completion:v0
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
            (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
            || '{"uri": "agenta:builtin:completion:v0"}'::jsonb
          )::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND flags->>'is_chat' = 'false'
          AND flags->>'is_evaluator' = 'false'
          AND flags->>'is_custom' = 'false'
    """)
    )

    # Row 13: No URI + no URL + custom non-evaluator local → user:custom:local:latest
    # Flatten script dict if present.
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
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
          )::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
          AND flags->>'is_chat' = 'false'
          AND flags->>'is_custom' = 'true'
          AND flags->>'is_evaluator' = 'false'
          AND (NOT (data::jsonb ? 'schemas') OR jsonb_typeof(data::jsonb -> 'schemas') = 'null')
    """)
    )

    # Row 15: No URI + Agenta service URL + chat → chat:v0
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
            (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
            || '{"uri": "agenta:builtin:chat:v0"}'::jsonb
          )::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND data::jsonb ->> 'url' IS NOT NULL
          AND flags->>'is_chat' = 'true'
          AND flags->>'is_custom' = 'false'
          AND flags->>'is_evaluator' = 'false'
    """)
    )

    # Row 16: No URI + Agenta service URL + completion → completion:v0
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
            (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
            || '{"uri": "agenta:builtin:completion:v0"}'::jsonb
          )::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
          AND data::jsonb ->> 'url' IS NOT NULL
          AND flags->>'is_chat' = 'false'
          AND flags->>'is_custom' = 'false'
          AND flags->>'is_evaluator' = 'false'
    """)
    )

    # ----------------------------------------------------------------
    # Phase 2: Existing-URI rows — normalize flags and strip legacy fields
    # ----------------------------------------------------------------

    # Row 14: user:custom — replace flags, flatten script dict if present
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
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
          )::json,
          flags = jsonb_build_object(
            'is_evaluator', COALESCE((flags->>'is_evaluator')::boolean, false),
            'is_application', NOT COALESCE((flags->>'is_evaluator')::boolean, false),
            'is_snippet', false
          )
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' LIKE 'user:custom:%'
    """)
    )

    # Row 8: auto_webhook_test:v0 — normalize fields
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')::json,
          flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:auto_webhook_test:v0'
    """)
    )

    # Row 9: auto_custom_code_run:v0 — normalize fields, flatten script dict
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
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
          )::json,
          flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:auto_custom_code_run:v0'
    """)
    )

    # Row 10: Other builtin evaluator URIs — normalize fields
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (data::jsonb - 'url' - 'headers' - 'script' - 'runtime' - 'service' - 'configuration')::json,
          flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
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

    # Row 4: hook:v0 — normalize fields (keep URI)
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0'
    """)
    )

    # Row 3: code:v0 — normalize fields, flatten script dict
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (
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
          )::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:code:v0'
    """)
    )

    # Row 1: chat:v0 — normalize fields
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0'
    """)
    )

    # Row 2: completion:v0 — normalize fields
    session.execute(
        text("""
        UPDATE workflow_revisions
        SET
          data = (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')::json,
          flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
        WHERE data IS NOT NULL
          AND data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0'
    """)
    )

    click.echo(
        click.style(
            "Successfully backfilled workflow revision URIs and normalized flags.",
            fg="green",
        ),
        color=True,
    )


def downgrade_workflow_revisions(session: Connection) -> None:
    """Downgrade is not supported.

    This migration destructively replaces flags (losing legacy values like
    is_chat, is_human, is_custom) and strips JSONB keys (service, configuration).
    The original values cannot be restored. Restore from backup if needed.
    """

    raise NotImplementedError(
        "Downgrade is not supported: this migration destructively replaces "
        "flags and strips legacy JSONB keys. Restore from backup if needed."
    )
