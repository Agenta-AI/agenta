import agenta as ag


def set_global(config=None, tracing=None):
    """Allows usage of agenta.config and agenta.tracing in the user's code."""

    if config is not None:
        ag.config = config
    if tracing is not None:
        ag.tracing = tracing
