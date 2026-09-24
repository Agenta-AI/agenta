class SessionStartError(Exception):
    pass


class SessionStartNotDurable(SessionStartError):
    def __init__(self, *, retryable: bool = True):
        self.retryable = retryable
        self.next_step = (
            "Retry with the same Idempotency-Key; do not submit a new request."
            if retryable
            else "Start a new template load with a new Idempotency-Key."
        )
        super().__init__("The initial session start was not durably recorded.")
