from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.secrets.dbas import SecretsDBA


class SecretsDBE(Base, SecretsDBA):
    __tablename__ = "secrets"
