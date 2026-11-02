class SessionStartError(Exception):
    pass


class SessionStartNotDurable(SessionStartError):
    def __init__(self):
        super().__init__(
            "The initial session start was not durably recorded. Retry with the same request key."
        )
