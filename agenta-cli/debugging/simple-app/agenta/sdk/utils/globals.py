import agenta


def set_global(config=None, tracing=None):
    """Allows usage of agenta.config and agenta.tracing in the user's code.

    Args:
        config: _description_. Defaults to None.
        tracing: _description_. Defaults to None.
    """
    if config is not None:
        agenta.config = config
    if tracing is not None:
        agenta.tracing = tracing
