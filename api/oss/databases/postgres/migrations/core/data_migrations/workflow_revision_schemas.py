import json
from typing import Any

import click
from sqlalchemy import Connection, text

from agenta.sdk.engines.running.utils import parse_uri
from oss.src.resources.workflows.catalog import get_workflow_catalog_template


BUILTIN_APPLICATION_URIS = (
    "agenta:builtin:chat:v0",
    "agenta:builtin:completion:v0",
)


def _data_from_catalog(uri: str) -> dict[str, Any]:
    _provider, _kind, key, _version = parse_uri(uri)
    template = get_workflow_catalog_template(template_key=key, is_application=True)

    data = template.data if template else None
    if data and data.uri == uri:
        return data.model_dump(mode="json", exclude_none=True)

    raise RuntimeError(f"Could not resolve workflow catalog data for URI: {uri}")


def _schemas_from_catalog(uri: str) -> dict[str, Any]:
    data = _data_from_catalog(uri)
    schemas = data.get("schemas")

    if isinstance(schemas, dict):
        return schemas

    raise RuntimeError(f"Could not resolve workflow schemas for URI: {uri}")


def upgrade_builtin_application_workflow_revision_schemas(
    session: Connection,
) -> None:
    """Replace stored builtin application schemas with catalog schemas.

    This intentionally overwrites the whole `schemas` field for matching
    workflow revisions. Re-running it is idempotent because equal schemas are
    skipped by the WHERE predicate.
    """

    total_updated = 0

    for uri in BUILTIN_APPLICATION_URIS:
        schemas = _schemas_from_catalog(uri)
        result = session.execute(
            text("""
            UPDATE workflow_revisions
            SET data = jsonb_set(
                data::jsonb,
                '{schemas}',
                CAST(:schemas AS jsonb),
                true
            )::json
            WHERE data IS NOT NULL
              AND data::jsonb ->> 'uri' = :uri
              AND data::jsonb -> 'schemas' IS DISTINCT FROM CAST(:schemas AS jsonb)
            """),
            {"uri": uri, "schemas": json.dumps(schemas)},
        )
        total_updated += result.rowcount or 0

    click.echo(
        click.style(
            "Updated "
            f"{total_updated} builtin chat/completion workflow revision schemas.",
            fg="green",
        ),
        color=True,
    )


def downgrade_builtin_application_workflow_revision_schemas(
    session: Connection,
) -> None:
    """Downgrade is not supported because previous schemas are overwritten."""

    raise NotImplementedError(
        "Downgrade is not supported: this migration overwrites workflow "
        "revision schemas without storing the previous values."
    )
