import os
import re
import traceback
from datetime import datetime
from typing import Dict, Any, Optional, Callable, Awaitable

import asyncio
import posthog
from fastapi import Request

from oss.src.services import db_manager
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__file__)


POSTHOG_API_KEY = os.environ.get("POSTHOG_API_KEY", "")
POSTHOG_HOST = os.environ.get("POSTHOG_HOST", "https://app.posthog.com")

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
}

# Structure: {"YYYY-MM-DD": {user_id1: {"event_name:auth_method": count}, user_id2: {...}}}
_daily_event_auth_counts_by_user: Dict[str, Dict[str, Dict[str, int]]] = {}


if POSTHOG_API_KEY:
    posthog.api_key = POSTHOG_API_KEY
    posthog.host = POSTHOG_HOST
    log.info("PostHog initialized with host %s:", POSTHOG_HOST)
else:
    log.warn("PostHog API key not found in environment variables")


def run_background_with_timeout(coro: Awaitable, timeout: float = 5.0):
    """
    Safely run a coroutine in the background with a timeout.

    Args:
        coro (Awaitable): The coroutine to run.
        timeout (float): Maximum allowed time in seconds.
    """

    async def wrapper():
        try:
            await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError:
            log.warn("❌ Background task timed out")
        except Exception as e:
            log.error("❌ Background task failed: %s", e)

    # Create and run the task
    asyncio.create_task(wrapper())


async def capture_event(
    user_email: str, event_name: str, properties: Optional[Dict[str, Any]] = None
):
    if not POSTHOG_API_KEY:
        log.warn(f"PostHog API key not set, skipping capture_event: {event_name}")
        return

    try:
        posthog.capture(
            distinct_id=user_email, event=event_name, properties=properties or {}
        )
    except Exception as e:
        log.error(f"❌ Error capturing event in PostHog: {e}")


async def analytics_middleware(request: Request, call_next: Callable):
    response = await call_next(request)
    try:
        path = request.url.path
        if any(re.match(pattern, path) for pattern in _EXCLUDED_PATHS):
            return response

        if not hasattr(request.state, "user_id") or not request.state.user_id:
            return response

        event_name = _get_event_name_from_path(path, request.method)
        if event_name is None:
            return response

        run_background_with_timeout(
            asyncio.create_task(
                _track_analytics_event(
                    request=request,
                    path=path,
                    method=request.method,
                    status_code=response.status_code,
                    event_name=event_name,
                )
            ),
            timeout=5,
        )

        return response

    except Exception:
        log.error("Analytics middleware error: %s", traceback.format_exc())
        return response


async def _track_analytics_event(
    request: Request, path: str, method: str, status_code: int, event_name: str
):
    try:
        if not hasattr(request.state, "user_id") or not request.state.user_id:
            return

        user = await db_manager.get_user_with_id(user_id=request.state.user_id)
        if not user:
            return

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

        # Check daily limits if the event is one of those to be limited per auth method
        if event_name in LIMITED_EVENTS_PER_AUTH:
            try:
                global _daily_event_auth_counts_by_user
                today = datetime.now().strftime("%Y-%m-%d")
                user_id = request.state.user_id

                # Clean up old tracking data to prevent memory growth
                if today not in _daily_event_auth_counts_by_user:
                    # Keep only today's data (which is empty at this point)
                    _daily_event_auth_counts_by_user = {today: {}}

                # Initialize user's tracking dictionary if not present
                if not _daily_event_auth_counts_by_user[today].get(user_id):
                    _daily_event_auth_counts_by_user[today][user_id] = {}

                # Create a combined key for event+auth method tracking
                event_auth_key = f"{event_name}:{auth_method}"
                limit = LIMITED_EVENTS_PER_AUTH[event_name]

                # Check event+auth method limit
                current_count = _daily_event_auth_counts_by_user[today][user_id].get(
                    event_auth_key, 0
                )
                if current_count >= limit:
                    return

                _daily_event_auth_counts_by_user[today][user_id][event_auth_key] = (
                    current_count + 1
                )
            except Exception as e:
                log.error(f"Error in daily event limit tracking: {e}")
                return

        properties = {
            "path": path,
            "method": method,
            "status_code": status_code,
        }

        properties["auth_method"] = auth_method

        if hasattr(request.state, "project_id") and request.state.project_id:
            properties["project_id"] = request.state.project_id
            try:
                project = await db_manager.get_project_by_id(request.state.project_id)
                if project:
                    properties["organization_id"] = str(project.organization_id)
                    properties["workspace_id"] = str(project.workspace_id)
                    organization = await db_manager.get_organization_by_id(
                        str(project.organization_id)
                    )
                    if organization:
                        properties["organization_name"] = organization.name
            except Exception as e:
                log.error(f"Error getting project details: {e}")

        await capture_event(
            user_email=user.email, event_name=event_name, properties=properties
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        log.error(f"Error tracking analytics event: {e}")


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
