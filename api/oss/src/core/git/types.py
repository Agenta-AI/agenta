class GitError(Exception):
    """Base exception for git-pattern domain errors."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class VariantForkError(GitError):
    """Raised when a variant fork request cannot be fulfilled."""
