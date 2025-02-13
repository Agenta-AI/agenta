from agenta_backend.dbs.postgres.shared.base import Base
from agenta_backend.dbs.secrets.dbas import SecretsDBA


class SecretsDBE(Base, SecretsDBA):
    __tablename__ = "secrets"
