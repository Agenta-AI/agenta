import re
import traceback
from datetime import datetime
from typing import Optional, Callable

import posthog
from fastapi import Request

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import set_cache, get_cache


log = get_module_logger(__name__)


POSTHOG_API_KEY = env.POSTHOG_API_KEY
POSTHOG_HOST = env.POSTHOG_HOST

_EXCLUDED_PATHS = [
    r"^/health",
    r"^/docs",
    r"^/openapi\\.json$",
    r"^/redoc",
]

_BEARER_TOKEN_PREFIX = "Bearer "
_APIKEY_TOKEN_PREFIX = "ApiKey "
_SECRET_TOKEN_PREFIX = "Secret "

# Events subject to per-auth-method daily limits
LIMITED_EVENTS_PER_AUTH = {
    "app_revision_fetched": 3,
    "spans_created": 3,
    "spans_fetched": 3,
}


if POSTHOG_API_KEY:
    posthog.api_key = POSTHOG_API_KEY
    posthog.host = POSTHOG_HOST
    log.info("PostHog initialized with host %s:", POSTHOG_HOST)
else:
    log.warn("PostHog API key not found in environment variables")


async def analytics_middleware(request: Request, call_next: Callable):
    response = await call_next(request)

    try:
        path = request.url.path
        if any(re.match(pattern, path) for pattern in _EXCLUDED_PATHS):
            return response

        event_name = _get_event_name_from_path(path, request.method)
        if not event_name:
            return response

        try:
            # Determine authentication method
            auth_header = (
                request.headers.get("Authorization")
                or request.headers.get("authorization")
                or ""
            )
            if auth_header.startswith(_BEARER_TOKEN_PREFIX):
                auth_method = "Bearer"
            elif auth_header.startswith(_APIKEY_TOKEN_PREFIX):
                auth_method = "ApiKey"
            elif auth_header.startswith(_SECRET_TOKEN_PREFIX):
                auth_method = "Secret"
            elif request.cookies.get("sAccessToken"):
                auth_method = "Session"
            else:  # We use API key without any prefix too.
                auth_method = "ApiKey"

            # Build base properties
            properties = {
                "path": path,
                "method": request.method,
                "status_code": response.status_code,
                "auth_method": auth_method,
            }

            if hasattr(request.state, "project_id") and request.state.project_id:
                properties["project_id"] = request.state.project_id

            if hasattr(request.state, "workspace_id") and request.state.workspace_id:
                properties["workspace_id"] = request.state.workspace_id

            if (
                hasattr(request.state, "organization_id")
                and request.state.organization_id
            ):
                properties["organization_id"] = request.state.organization_id

            if (
                hasattr(request.state, "organization_name")
                and request.state.organization_name
            ):
                properties["organization_name"] = request.state.organization_name

            # Check daily limits if the event is one of those to be limited per auth method
            if event_name in LIMITED_EVENTS_PER_AUTH:
                # --------------------------------------------------------------
                today = datetime.now().strftime("%Y-%m-%d")
                event_auth_key = f"{event_name}:{auth_method}"

                # Create a combined key for event+auth method tracking
                cache_key = {
                    "today": today,
                    "event_auth_key": event_auth_key,
                }

                current_count = await get_cache(
                    project_id=request.state.project_id,
                    user_id=request.state.user_id,
                    namespace="posthog:analytics",
                    key=cache_key,
                    retry=False,
                )

                if current_count is None:
                    current_count = 0

                # --------------------------------------------------------------
                current_count = int(current_count)
                limit = LIMITED_EVENTS_PER_AUTH[event_name]
                if current_count >= limit:
                    return response

                await set_cache(
                    project_id=request.state.project_id,
                    user_id=request.state.user_id,
                    namespace="posthog:analytics",
                    key=cache_key,
                    value=current_count + 1,
                    ttl=24 * 60 * 60,  # 24 hours
                )
                # --------------------------------------------------------------

            # log.debug(
            #     distinct_id=request.state.user_email,
            #     event=event_name,
            #     properties=properties,
            # )

            if env.POSTHOG_API_KEY:
                posthog.capture(
                    distinct_id=request.state.user_email,
                    event=event_name,
                    properties=properties or {},
                )
        except Exception as e:
            log.error(f"❌ Error capturing event in PostHog: {e}")

        return response

    except Exception:
        log.error("Analytics middleware error: %s", traceback.format_exc())
        return response


def _get_event_name_from_path(
    path: str,
    method: str,
) -> Optional[str]:
    path_parts = [p for p in path.strip("/").split("/") if p]
    if not path_parts:
        return None

    # <-------- Application Events -------->
    if method == "POST" and path == "/apps":
        return "app_created"
    # <-------- End of Application Events -------->

    # <----------- Configuration Events ------------->
    if method == "POST" and ("/from-base" in path or "/variants/configs/add" in path):
        return "app_variant_created"

    elif method == "PUT" and ("variants" in path_parts and "parameters" in path_parts):
        return "app_revision_created"

    elif method == "POST" and (
        "/variants/configs/commit" in path or "/variants/configs/fork" in path
    ):
        return "app_revision_created"

    elif method == "POST" and (
        "/environments/deploy" in path or "/variants/configs/deploy" in path
    ):
        return "environment_revision_created"

    elif method == "POST" and "/variants/configs/fetch" in path:
        return "app_revision_fetched"
    # <----------- End of Configuration Events ------------->

    # <----------- Test sets Events ------------->
    if method == "POST" and "/testsets" in path:
        return "testset_created"

    elif method == "GET" and "/testsets" in path:
        return "testsets_fetched"

    elif method == "PUT" and "/testsets" in path:
        return "testset_updated"
    # <----------- End of Test sets Events ------------->

    # <----------- Evaluation Events ------------->
    if method == "POST" and "/evaluators/configs" in path:
        return "evaluator_created"

    elif method == "PUT" and "/evaluators/configs/" in path:
        return "evaluator_updated"

    elif (
        method == "POST"
        and ("/evaluations" in path)
        or ("evaluators" in path_parts and "run" in path_parts)
    ):
        return "evaluation_created"

    elif method == "POST" and "/human-evaluations" in path:
        return "human_evaluation_created"
    # <----------- End of Evaluation Events ------------->

    # <----------- Observability Events ------------->
    if method == "POST" and (
        "/otlp/v1/traces" in path or "/observability/v1/otlp/traces" in path
    ):
        return "spans_created"

    elif method == "GET" and "/observability/v1/traces" in path:
        return "spans_fetched"
    # <----------- End of Observability Events ------------->

    # <----------- User Lifecycle Events ------------->
    if (
        method == "POST"
        and ("/invite" in path)
        and ("invite" in path_parts and "resend" in path_parts)
    ):
        return "invitation_created"
    # <----------- End of User Lifecycle Events ------------->

    return None
