from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version


@lru_cache(maxsize=1)
def get_agenta_version() -> str:
    """The running release, as "v0.128.11". The API project has no package metadata
    (`package = false`), so this reads the bundled Agenta SDK, which ships with it."""
    try:
        return f"v{version('agenta')}"
    except PackageNotFoundError:
        return "unknown"
