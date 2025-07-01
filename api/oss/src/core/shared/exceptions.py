from typing import Optional, Dict, Any


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

        for key, value in self.conflict.items():
            _message += f" {key}={value}"

        return _message
