import os

from cachetools import TTLCache, cached

from agenta.client.backend.client import AgentaApi


class Agenta:
    """Client class for interacting with the Agenta API."""

    def __init__(self, api_key: str = None, host: str = None):
        """
        Initializes the Agenta client with API key and host.

        Raises:
            EnvironmentError: If AGENTA_API_KEY is not set.
        """
        if not api_key and not os.environ.get("AGENTA_API_KEY"):
            raise EnvironmentError(
                "Required environment variables AGENTA_API_KEY is not set."
            )
        self.api_key = api_key if api_key else os.environ.get("AGENTA_API_KEY")
        self.host = (
            host if host else os.environ.get("AGENTA_HOST", "https://cloud.agenta.ai")
        )
        self.cache = TTLCache(maxsize=1024, ttl=300)
        backend_url = f"{self.host}/api"
        self.client = AgentaApi(base_url=backend_url, api_key=self.api_key)

    def get_config(self, base_id: str, environment: str, cache_timeout: int = 300):
        """
        Fetches and caches the configuration for a specified base ID and environment.

        Args:
            base_id (str): The unique identifier for the base.
            environment (str): The environment name (e.g., 'production', 'development').
            cache_timeout (int): The TTL for the cache in seconds. Defaults to 300 seconds.

        Returns:
            dict: The configuration data retrieved from the Agenta API.

        Raises:
            EnvironmentError: If the required AGENTA_API_KEY is not set in the environment variables.
        """
        if cache_timeout != self.cache.ttl:
            self.cache = TTLCache(
                maxsize=1024, ttl=cache_timeout
            )  # TODO: We need to modify this to use a dynamic TTLCache implementation in the future

        @cached(cache=self.cache)
        def fetch_config(base_id: str, environment: str = "production"):
            return self.client.configs.get_config(
                base_id=base_id, environment_name=environment
            )

        return fetch_config(base_id, environment)
