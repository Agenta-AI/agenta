"""The principal of the current request.

The auth middleware sets it right after the auth context and resets it when the
request ends. `check_action_access` reads it; nothing else may build a principal from
a bare user id. Outside an authenticated tenant request it is `None`.
"""

from contextvars import ContextVar, Token
from typing import Any, Dict, Optional, Tuple

from oss.src.core.access.dtos import RequestAccess


_request_access: ContextVar[Optional[RequestAccess]] = ContextVar(
    "request_access",
    default=None,
)


# What the access decisions of one request already read (principal records and
# memberships), so a second decision in the same request makes no Redis round trip.
# Scoped to the request: it never outlives it, so it never serves a revoked answer
# to a later request.
_request_memo: ContextVar[Optional[Dict[Any, Any]]] = ContextVar(
    "request_access_memo",
    default=None,
)


def set_request_access(access: RequestAccess) -> Tuple[Token, Token]:
    return _request_access.set(access), _request_memo.set({})


def reset_request_access(token: Tuple[Token, Token]) -> None:
    access_token, memo_token = token
    _request_memo.reset(memo_token)
    _request_access.reset(access_token)


def get_request_memo() -> Optional[Dict[Any, Any]]:
    return _request_memo.get()


def clear_request_memo() -> None:
    """Called by every invalidation: a write in this request is seen by its later
    decisions."""

    memo = _request_memo.get()
    if memo is not None:
        memo.clear()


def get_request_access() -> Optional[RequestAccess]:
    return _request_access.get()
