class InteractionError(Exception):
    pass


class InteractionNotFound(InteractionError):
    pass


class InteractionAlreadyTerminal(InteractionError):
    pass


class InteractionCrossTenant(InteractionError):
    pass
