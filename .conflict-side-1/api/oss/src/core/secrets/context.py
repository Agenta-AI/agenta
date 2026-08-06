import contextvars
from contextlib import contextmanager


# Global context variable for data encryption context
data_encryption_context = contextvars.ContextVar(
    "data_encryption_context", default=None
)


@contextmanager
def set_data_encryption_key(data_encryption_key):
    """
    Context manager to set and reset the encryption passphrase

    Args:
        data_encryption_key (str): The encryption key to use

    Yields:
        Context with passphrase set
    """

    token = data_encryption_context.set(data_encryption_key)
    try:
        yield
    finally:
        data_encryption_context.reset(token)


def get_data_encryption_key():
    """
    Retrieve the current passphrase from context

    Returns:
        Current passphrase or None

    Exceptions:
        raises ValueError: If no mastersecret is set
    """

    data_encryption_key = data_encryption_context.get()
    if data_encryption_key is None:
        raise ValueError("Data encryption key must be set in the context.")
    return data_encryption_key
