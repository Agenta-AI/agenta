"""The principal of the current request.

The auth middleware sets it right after the auth context and resets it when the
request ends. `check_action_access` reads it; nothing else may build a principal from
a bare user id. Outside an authenticated tenant request it is `None`.
"""

from contextvars import ContextVar, Token
from typing import Optional

from oss.src.core.access.dtos import RequestAccess


_request_access: ContextVar[Optional[RequestAccess]] = ContextVar(
    "request_access",
    default=None,
)


def set_request_access(access: RequestAccess) -> Token:
    return _request_access.set(access)


def reset_request_access(token: Token) -> None:
    _request_access.reset(token)


def get_request_access() -> Optional[RequestAccess]:
    return _request_access.get()
