"""add organization scope to secrets and link sso providers

Revision ID: c3b2a1d4e5f6
Revises: a9f3e8b7c5d1
Create Date: 2025-01-10 00:00:00.000000

"""

from typing import Sequence, Union
import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
import uuid_utils.compat as uuid

from oss.src.utils.env import env


# revision identifiers, used by Alembic.
revision: str = "c3b2a1d4e5f6"
down_revision: Union[str, None] = "a9f3e8b7c5d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()

    op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'SSO_PROVIDER'")

    inspector = sa.inspect(connection)
    secrets_columns = {col["name"] for col in inspector.get_columns("secrets")}

    if "organization_id" not in secrets_columns:
        op.add_column("secrets", sa.Column("organization_id", sa.UUID(), nullable=True))

    op.alter_column("secrets", "project_id", nullable=True)

    secrets_fks = {fk["name"] for fk in inspector.get_foreign_keys("secrets")}
    if "secrets_organization_id_fkey" not in secrets_fks:
        op.create_foreign_key(
            "secrets_organization_id_fkey",
            "secrets",
            "organizations",
            ["organization_id"],
            ["id"],
            ondelete="CASCADE",
        )

    org_providers_columns = {
        col["name"] for col in inspector.get_columns("organization_providers")
    }
    if "secret_id" not in org_providers_columns:
        op.add_column(
            "organization_providers", sa.Column("secret_id", sa.UUID(), nullable=True)
        )

    org_providers_fks = {
        fk["name"] for fk in inspector.get_foreign_keys("organization_providers")
    }
    if "organization_providers_secret_id_fkey" not in org_providers_fks:
        op.create_foreign_key(
            "organization_providers_secret_id_fkey",
            "organization_providers",
            "secrets",
            ["secret_id"],
            ["id"],
            ondelete="CASCADE",
        )

    if "settings" in org_providers_columns:
        encryption_key = env.agenta.crypt_key
        if not encryption_key:
            raise RuntimeError(
                "Encryption key not found. Cannot migrate organization provider secrets."
            )

        providers = connection.execute(
            sa.text(
                """
                SELECT id, organization_id, slug, name, description, settings, created_at, updated_at
                FROM organization_providers
                WHERE secret_id IS NULL
                """
            )
        ).fetchall()

        for provider in providers:
            settings = provider.settings or {}
            settings.setdefault("client_id", "")
            settings.setdefault("client_secret", "")
            settings.setdefault("issuer_url", "")
            settings.setdefault("scopes", [])
            settings.setdefault("extra", {})

            secret_data = json.dumps({"provider": settings})
            secret_id = uuid.uuid7()

            connection.execute(
                text(
                    """
                    INSERT INTO secrets (
                        id, kind, data, organization_id, project_id, created_at, updated_at, name, description
                    )
                    VALUES (
                        :id,
                        'SSO_PROVIDER',
                        pgp_sym_encrypt(:data, :key),
                        :organization_id,
                        NULL,
                        :created_at,
                        :updated_at,
                        :name,
                        :description
                    )
                    """
                ),
                {
                    "id": secret_id,
                    "data": secret_data,
                    "key": encryption_key,
                    "organization_id": provider.organization_id,
                    "created_at": provider.created_at,
                    "updated_at": provider.updated_at,
                    "name": provider.slug,
                    "description": provider.description,
                },
            )

            connection.execute(
                sa.text(
                    "UPDATE organization_providers SET secret_id = :secret_id WHERE id = :provider_id"
                ),
                {"secret_id": secret_id, "provider_id": provider.id},
            )

        op.drop_column("organization_providers", "settings")

    op.alter_column("organization_providers", "secret_id", nullable=False)


def downgrade() -> None:
    op.drop_constraint(
        "organization_providers_secret_id_fkey",
        "organization_providers",
        type_="foreignkey",
    )
    op.add_column(
        "organization_providers",
        sa.Column(
            "settings",
            sa.JSON(),
            nullable=True,
        ),
    )
    op.drop_column("organization_providers", "secret_id")

    op.drop_constraint("secrets_organization_id_fkey", "secrets", type_="foreignkey")
    op.drop_column("secrets", "organization_id")
    op.alter_column("secrets", "project_id", nullable=False)
