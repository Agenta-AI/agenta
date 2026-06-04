import click
from sqlalchemy import Connection, text


ALLOWED_KEYS = (
    "uri",
    "url",
    "headers",
    "runtime",
    "script",
    "schemas",
    "parameters",
)


def upgrade_workflow_revision_data_extras(session: Connection) -> None:
    """Strip unknown top-level keys from workflow_revisions.data.

    WorkflowRevisionData enforces extra="forbid" on the allowed keys. Legacy
    rows that still carry other top-level keys (e.g. 'mappings', 'service',
    'configuration') trip Pydantic validation on read; the query endpoint
    silently swallows the exception and returns an empty result. This
    rewrites such rows to keep only the allowed keys.

    NULL rows are left as NULL. Rows whose strip would leave no allowed keys
    become {} rather than NULL.
    """

    result = session.execute(
        text(
            """
            UPDATE workflow_revisions
            SET data = COALESCE(
                (
                    SELECT jsonb_object_agg(kv.key, kv.value)
                    FROM jsonb_each(data::jsonb) AS kv
                    WHERE kv.key = ANY(:allowed)
                ),
                '{}'::jsonb
            )::json
            WHERE data IS NOT NULL
              AND json_typeof(data) = 'object'
              AND EXISTS (
                SELECT 1
                FROM jsonb_object_keys(data::jsonb) AS k(key)
                WHERE k.key <> ALL(:allowed)
              )
            """
        ),
        {"allowed": list(ALLOWED_KEYS)},
    )

    click.echo(
        click.style(
            f"Stripped unknown top-level keys from {result.rowcount} workflow_revisions.data rows",
            fg="green",
        ),
        color=True,
    )


def downgrade_workflow_revision_data_extras(session: Connection) -> None:
    """Downgrade is not supported.

    This migration destructively strips unknown top-level keys from
    workflow_revisions.data. The original values cannot be restored.
    """

    raise NotImplementedError(
        "Downgrade is not supported: this migration destructively strips "
        "unknown top-level keys from workflow_revisions.data. Restore from "
        "backup if needed."
    )
