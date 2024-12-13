import importlib.metadata


def get_current_version():
    """Returns the current version of Agenta's SDK."""

    version = importlib.metadata.version("agenta")
    return version
