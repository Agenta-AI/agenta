from typing import Optional, Dict, Any


class EntityCreationIdempotencyConflict(Exception):
    """An idempotency key was reused with a different request fingerprint."""

    def __init__(self, *, namespace: str) -> None:
        self.namespace = namespace
        super().__init__("The idempotency key is already bound to a different request.")


class EntityCreationConflict(Exception):
    """Exception raised when trying to create an entity that already exists."""

    def __init__(
        self,
        entity: str = "Entity",
        message: str = "{{entity}} with same keys already exists.",
        conflict: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)

        self.message = message.replace("{{entity}}", entity)
        self.conflict = conflict

    def __str__(self):
        _message = self.message

        if self.conflict:
            for key, value in self.conflict.items():
                _message += f" {key}={value}"

        return _message
