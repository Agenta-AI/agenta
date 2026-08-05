import click
from sqlalchemy import Connection, text

OSS_SINGLETON_ORG_SLUG = "oss-default"


def upgrade_organizations_slug_backfill(session: Connection) -> None:
    existing = session.execute(
        text(
            """
            SELECT id
            FROM organizations
            WHERE slug = :slug
            LIMIT 1
            """
        ),
        {"slug": OSS_SINGLETON_ORG_SLUG},
    ).fetchone()

    if existing is not None:
        click.echo(
            click.style(
                f"Organization slug '{OSS_SINGLETON_ORG_SLUG}' already exists; skipping backfill",
                fg="green",
            ),
            color=True,
        )
        return

    legacy_organizations = session.execute(
        text(
            """
            SELECT id
            FROM organizations
            WHERE slug IS NULL
            ORDER BY created_at ASC, id ASC
            """
        )
    ).fetchall()

    if not legacy_organizations:
        click.echo(
            click.style(
                "No legacy organizations with NULL slug found; skipping backfill",
                fg="green",
            ),
            color=True,
        )
        return

    if len(legacy_organizations) > 1:
        click.echo(
            click.style(
                "Found multiple legacy organizations with NULL slug; promoting the oldest row to oss-default",
                fg="yellow",
            ),
            color=True,
        )

    chosen_organization_id = legacy_organizations[0][0]
    result = session.execute(
        text(
            """
            UPDATE organizations
            SET slug = :slug
            WHERE id = :organization_id
              AND slug IS NULL
            """
        ),
        {
            "slug": OSS_SINGLETON_ORG_SLUG,
            "organization_id": chosen_organization_id,
        },
    )
    session.commit()

    click.echo(
        click.style(
            f"Backfilled {result.rowcount} legacy organization row with slug '{OSS_SINGLETON_ORG_SLUG}'",
            fg="green",
        ),
        color=True,
    )


def downgrade_organizations_slug_backfill(session: Connection) -> None:
    raise NotImplementedError(
        "Downgrade is not supported: this migration backfills the OSS singleton "
        "organization slug on existing rows. Restore from backup if needed."
    )
