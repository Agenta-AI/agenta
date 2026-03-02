from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from fastapi import APIRouter

from agenta.sdk.utils.lazy import _load_fastapi

_router: Optional["APIRouter"] = None


class _LazyRouter:
    def __getattr__(self, name):
        return getattr(get_router(), name)

    def __call__(self, *args, **kwargs):
        return get_router()(*args, **kwargs)


def get_router() -> "APIRouter":
    global _router  # pylint: disable=global-statement

    if _router is None:
        fastapi = _load_fastapi()
        _router = fastapi.APIRouter()

        @_router.get("/health")
        def health():
            return {"status": "ok"}

    return _router


router = _LazyRouter()
