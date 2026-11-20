from typing import Optional


class SessionInputError(Exception):
    pass


class SessionInputBusy(SessionInputError):
    def __init__(self, current_execution_id: Optional[str] = None):
        self.current_execution_id = current_execution_id
        super().__init__("The session is already running an execution.")


class SessionInputNotFound(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__("The pending input was not found.")


class SessionInputNotRemovable(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__("The input can no longer be removed because it was promoted.")


class SessionInputIdempotencyConflict(SessionInputError):
    def __init__(self):
        super().__init__("This idempotency key was already used for a different input.")


class SessionInputRemoved(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__("The queued input was removed and cannot be sent.")


class SessionInputNotEditable(SessionInputError):
    def __init__(self, input_id: str):
        self.input_id = input_id
        super().__init__(
            "The queued input is no longer editable because it was removed, promoted, or selected to run next."
        )


class SessionInputContentInvalid(SessionInputError):
    pass


# Every key that server code builds for a session input starts with this namespace. A
# client key with it is refused, so a client never takes a server key first in a session
# it can also write to. The prefix only reserves keys: rules read `kind`, never the key.
SERVER_INPUT_KEY_PREFIX = "ag:"


def is_reserved_input_key(key: Optional[str]) -> bool:
    return bool(key) and key.startswith(SERVER_INPUT_KEY_PREFIX)


class SessionInputKeyReserved(SessionInputError):
    def __init__(self):
        super().__init__(
            f"Idempotency keys that start with '{SERVER_INPUT_KEY_PREFIX}' are reserved."
        )


class SessionInputEditRefused(SessionInputError):
    """Only the sender of a queued message may edit it, and nobody may edit a server
    input. `reason`: `server_input` or `not_sender`."""

    def __init__(self, input_id: str, reason: str):
        self.input_id = input_id
        self.reason = reason
        super().__init__(
            "Only the person who sent this queued message can edit it."
            if reason == "not_sender"
            else "This queued input was written by the server and cannot be edited."
        )


class SessionInputEnvelopeMismatch(SessionInputError):
    def __init__(self):
        super().__init__("The run envelope belongs to another project.")
