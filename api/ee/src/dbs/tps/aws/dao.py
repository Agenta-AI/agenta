from abc import ABC, abstractmethod
from typing import Optional, Union, Dict


class SystemSecretDAOInterface(ABC):
    """
    Interface for interacting with a system secrets dao.
    """

    def __init__(self, **kwargs):
        raise NotImplementedError

    @abstractmethod
    def fetch_secret(
        self, credentials: str, secret_key: Optional[str] = None
    ) -> Optional[Union[Dict[str, str], str]]:
        """
        Fetch a secret by its credentials.

        Args:
            credentials (str): Required credentials to fetch the secret
            secret_key (Optional[str]): Specific key to retrieve (in the case the secret comes as a dictionary)

        Returns:
            Secret value or None if retrieval fails.
        """

        raise NotImplementedError
