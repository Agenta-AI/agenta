from sqlalchemy import ForeignKeyConstraint, Index, text

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.secrets.dbas import SecretsDBA


class SecretsDBE(Base, SecretsDBA):
    __tablename__ = "secrets"

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        Index(
            "uq_secrets_project_id_slug",
            "project_id",
            "slug",
            unique=True,
            postgresql_where=text("slug IS NOT NULL"),
        ),
    )
