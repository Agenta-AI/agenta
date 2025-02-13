from sqlalchemy import (
    String,
    func,
    type_coerce,
    TypeDecorator,
)
from sqlalchemy.dialects.postgresql import BYTEA

from agenta_backend.core.secrets.context import get_data_encryption_key


class PGPString(TypeDecorator):
    """
    SQLAlchemy TypeDecorator for dynamic PGP encryption/decryption
    Uses a context variable to manage the data encryption key
    """

    impl = BYTEA
    cache_ok = True

    def bind_expression(self, bindvalue):
        """
        Encrypt the value using the data encryption key context ==

        Args:
            bindvalue (Any): The value to encrypt

        Returns:
            Encrypted value

        Exceptions:
            ValueError: If no data encryption key is set in context
        """

        bindvalue = type_coerce(bindvalue, String)
        data_encryption_key = get_data_encryption_key()
        if data_encryption_key is None:
            raise ValueError(
                "Data encryption key must be set in the context before using PGPString."
            )

        return func.pgp_sym_encrypt(bindvalue, data_encryption_key)

    def column_expression(self, col):
        """
        Decrypt the value using the current context passphrase

        Args:
            col (Any): The encrypted column

        Returns:
            Decrypted value

        Exceptions:
            ValueError: If no data encryption key is set in context
        """

        data_encryption_key = get_data_encryption_key()
        if data_encryption_key is None:
            raise ValueError(
                "Data encryption key must be set in the context before using PGPString."
            )
        return func.pgp_sym_decrypt(col, data_encryption_key)
