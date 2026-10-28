from hmac import compare_digest
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

from fastapi import APIRouter, Query, HTTPException, Request
from fastapi.responses import JSONResponse

from oss.src.middlewares.auth import (
    SECRET_RESOLVE_GRANT,
    request_run_envelope,
    sign_secret_token,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.utils.context import get_auth_context, get_auth_scope
from oss.src.utils.common import is_ee
from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.context import get_request_access
from oss.src.core.access.principals import access_denied_error
from oss.src.core.access.service import get_access_service
from oss.src.core.access.permissions.controls import SCOPES
from oss.src.core.access.controls import get_roles

if is_ee():
    from ee.src.core.access.entitlements.service import check_entitlements, Counter


log = get_module_logger(__name__)


class Allow(JSONResponse):
    def __init__(
        self,
        credentials: Optional[str] = None,
    ) -> None:
        super().__init__(
            status_code=200,
            content={
                "effect": "allow",
                "credentials": credentials,
            },
        )


class Deny(HTTPException):
    def __init__(self, detail: Any = "Forbidden") -> None:
        super().__init__(
            status_code=403,
            detail=detail,
        )


async def _check_scope_access(
    scope_type: Optional[str] = None,
    scope_id: Optional[UUID] = None,
) -> bool:
    auth_scope = get_auth_scope()

    allow_scope = False

    if scope_type == "project":
        allow_scope = str(auth_scope.project_id) == str(scope_id)
    elif scope_type == "workspace":
        # Workspaces were removed: the organization id is where a workspace id was.
        allow_scope = str(scope_id) == str(auth_scope.organization_id)
    elif not scope_type and not scope_id:
        allow_scope = True

    return allow_scope


async def _check_resource_access(
    resource_type: Optional[str] = None,
) -> Union[bool, int]:
    allow_resource = False

    if resource_type == "service":
        allow_resource = True

    if resource_type == "local_secrets":
        # EE meters local secret usage against the credits counter. OSS has no
        # credits meter, so it just grants access to authorized callers.
        if not is_ee():
            return True

        check, meter, _ = await check_entitlements(  # type: ignore
            key=Counter.CREDITS_CONSUMED,  # type: ignore
            delta=1,
        )

        if not check:
            return False

        if not meter or not meter.value:
            return False

        return meter.value

    return allow_resource


_RUNTIME_KEY_HEADER = "x-agenta-runtime-key"
# The placeholder `env.py` falls back to when nothing is configured.
_UNCONFIGURED_KEY = "replace-me"


def _is_platform_runtime(request: Request) -> bool:
    """Whether this caller proved it is the platform runtime, not a user agent.

    The workflow service exchanges the END USER's credential on the user's behalf, so
    nothing about the presented token distinguishes a real run from a browser calling the
    same public route. What distinguishes them is a secret only the runtime holds, sent
    on this internal hop and compared in constant time. It is never logged, never
    returned, and never reaches the runner or a sandbox.
    """
    presented = request.headers.get(_RUNTIME_KEY_HEADER)
    if not presented:
        return False

    expected = env.agenta.services_internal_key
    # A deployment that configured nothing keeps the well-known placeholder, which anyone
    # could send. Treat it as "no runtime configured" rather than as a secret: such a
    # deployment issues no grant at all, which costs it only the ability to run against
    # write-only secrets — off by default — and never hands the ability to a stranger.
    if not expected or expected == _UNCONFIGURED_KEY:
        return False

    return compare_digest(presented.encode("utf-8"), expected.encode("utf-8"))


def _run_credential_grants(request: Request, *, action: Optional[str]) -> List[str]:
    """The grants the credential this exchange returns may carry.

    Two ways to hold the secret-resolve grant, and no third: the platform runtime asks
    for a run credential and proves what it is (the workflow service, on the hop that
    starts a run), or the caller already holds the grant on a verified Secret token and
    is refreshing it (the runner, every few heartbeats). A session or ApiKey principal
    reaching this route directly gets neither, which is what keeps a member who may run a
    service from reading write-only values by asking for a credential.
    """
    if action == "run_service" and _is_platform_runtime(request):
        return [SECRET_RESOLVE_GRANT]

    return [
        grant
        for grant in getattr(request.state, "token_grants", ()) or ()
        if grant == SECRET_RESOLVE_GRANT
    ]


class AccessRouter:
    def __init__(self) -> None:
        self.router = APIRouter()

        self.router.add_api_route(
            "/permissions/check",
            self.check_permissions,
            methods=["GET"],
            operation_id="check_permissions",
        )

        self.router.add_api_route(
            "/roles",
            self.fetch_roles,
            methods=["GET"],
            operation_id="fetch_access_roles",
        )

    @intercept_exceptions()
    async def fetch_roles(self) -> Dict[str, List[Dict[str, Any]]]:
        """Return the effective role catalog per scope (organization,
        workspace, project). RBAC is an OSS feature, so this is served in both
        editions; the frontend reads the `workspace` scope for the members UI.
        """
        return {scope: list(get_roles(scope)) for scope in SCOPES}

    async def check_permissions(
        self,
        request: Request,
        action: Optional[str] = Query(None),
        scope_type: Optional[str] = Query(None),
        scope_id: Optional[UUID] = Query(None),
        resource_type: Optional[str] = Query(None),
        resource_id: Optional[UUID] = Query(None),
        without_grants: bool = Query(False),
    ):
        """Evaluate a permission against the AUTHENTICATED scope.

        `scope_id` asserts that the request was authenticated for that scope; it never
        selects it. A caller asking about a specific project must also send the
        `project_id` query param the auth middleware reads — a session with no explicit
        `project_id` is scoped to the default project, and any other `scope_id` is denied
        regardless of the caller's role there.
        """
        ctx = get_auth_context()
        project_id = str(ctx.scope.project_id)
        user_id = str(ctx.scope.user_id)

        # No cache stores the answer: every exchange decides again (F4), so a deleted
        # key or a removed member is refused on its next exchange. The credential is
        # minted only after the three checks allow.
        try:
            if not action or not resource_type:
                log.warn("Missing required parameters: action, resource_type")
                raise Deny()

            # CHECK PERMISSION 1/3: SCOPE
            allow_scope = await _check_scope_access(
                scope_type=scope_type,
                scope_id=scope_id,
            )
            if not allow_scope:
                log.warn("Scope access denied")
                raise Deny()

            # CHECK PERMISSION 2/3: ACTION, for the request's principal
            access = get_request_access()
            if access is None:
                raise Deny()
            decision = await get_access_service().check_request(
                access=access,
                action=Permission(action),
                project_id=ctx.scope.project_id,
            )
            if not decision.allowed:
                log.warn("Action access denied")
                # The refusal says why (`not_member`, `principal_inactive`, ...).
                raise Deny(
                    access_denied_error(
                        decision=decision,
                        principal_kind=access.principal.kind,
                        project_id=ctx.scope.project_id,
                    ).model_dump(exclude_none=True)
                )

            # CHECK PERMISSION 3/3: RESOURCE
            allow_resource = await _check_resource_access(
                resource_type=resource_type,
            )
            if isinstance(allow_resource, bool):
                if allow_resource is not True:
                    log.warn("Resource access denied")
                    raise Deny()
            elif isinstance(allow_resource, int):
                if allow_resource <= 0:
                    log.warn("Resource access denied")
                    raise Deny()
            else:
                log.warn("Resource access denied")
                raise Deny()

        except Deny:
            raise
        except Exception as exc:  # pylint: disable=broad-except
            log.warn(exc)
            raise Deny() from exc

        # Always mint a fresh ephemeral Secret token (same scope, new expiry) so the
        # returned credential is uniformly short-lived and renewable — never echoing an
        # ApiKey/Bearer. Callers (services, the runner) re-check periodically to refresh.
        #
        # Who may receive a credential that reads write-only secret values: see
        # `_run_credential_grants`. Minting on `action` alone made the grant self-serve —
        # a member who may run a service could ask for it with their own session or
        # ApiKey and spend it on the vault routes, which is the write-only guarantee gone.
        #
        # `without_grants` asks for the same credential with no grant at all. The code
        # evaluator sandbox runs user-written code, and this is the credential it holds.
        grants = (
            []
            if without_grants is True
            else _run_credential_grants(request, action=action)
        )
        # The new credential copies the caller's run envelope: same principal, same
        # authority, same run. It never upgrades a principal.
        envelope = request_run_envelope(request)
        if envelope is None:
            raise Deny()
        secret_token = await sign_secret_token(
            user_id=user_id,
            user_email=getattr(request.state, "user_email", None),
            project_id=project_id,
            organization_id=str(ctx.scope.organization_id),
            organization_name=getattr(request.state, "organization_name", None),
            grants=grants or None,
            envelope=envelope,
        )
        return Allow(f"Secret {secret_token}")
