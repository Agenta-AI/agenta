"""Shared domain-failure base; concrete failures live in each domain's types.py."""


class DomainError(Exception):
    """Base for typed domain failures mapped to stable HTTP error codes."""

    code: str = "domain_error"
    retryable: bool = False

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.details = details or {}
