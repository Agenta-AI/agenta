import agenta


def set_global(setup=None, config=None):
    """Allows usage of agenta.config and agenta.setup in the user's code.

    Args:
        setup: _description_. Defaults to None.
        config: _description_. Defaults to None.
    """
    if setup is not None:
        agenta.setup = setup
    if config is not None:
        agenta.config = config
