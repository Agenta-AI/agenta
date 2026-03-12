from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import display_exception

# Import shared vault logic from middlewares/running/vault.py
from agenta.sdk.middlewares.running.vault import (
    get_secrets,
    DenyException,
    _strip_service_prefix,
    _ALWAYS_ALLOW_LIST,
    invalidate_secrets_cache,
)

import agenta as ag

log = get_module_logger(__name__)


class VaultMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

        self.scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
        self.scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.vault = {}
        credentials = None

        try:
            credentials = request.state.auth.get("credentials")

            # Determine if we should skip permission check for this path
            skip_permission_check = (
                _strip_service_prefix(request.url.path) in _ALWAYS_ALLOW_LIST
            )

            secrets, vault_secrets, local_secrets = await get_secrets(
                api_url=f"{self.host}/api",
                credentials=credentials,
                host=self.host if not skip_permission_check else None,
                scope_type=self.scope_type,
                scope_id=self.scope_id,
            )

            request.state.vault = {
                "secrets": secrets,
                "vault_secrets": vault_secrets,
                "local_secrets": local_secrets,
            }
        except DenyException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.content},
                headers=exc.headers,
            )
        except Exception:  # pylint: disable=bare-except
            display_exception("Vault: Secrets Exception")

        response = await call_next(request)

        try:
            detail = None
            if response.status_code == 400:
                detail = getattr(response, "body", b"")
                if detail:
                    detail = detail.decode("utf-8", errors="ignore")

            if detail and "No API key found for model" in detail:
                invalidate_secrets_cache(credentials)
        except Exception:  # pylint: disable=bare-except
            display_exception("Vault: Cache Invalidation Exception")

        return response
