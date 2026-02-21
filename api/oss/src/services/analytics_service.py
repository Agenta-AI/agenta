import re
import traceback
from datetime import datetime
from typing import Callable, Optional

import posthog
from fastapi import Request
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.common import is_oss
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


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

# Activation events and their corresponding person properties
# Maps event names to (property_name, allowed_auth_methods)
# If allowed_auth_methods is None, all auth methods are allowed
ACTIVATION_EVENTS = {
    "app_revision_fetched": ("activated_prompt_management", {"ApiKey"}),
    "query_created": ("activated_online_evaluation", None),
    "spans_created": ("activated_observability", {"ApiKey"}),
    "evaluation_created": ("activated_evaluation", None),
    "app_variant_created": ("activated_playground", None),
    "user_invitation_sent_v1": ("invited_user_v1", None),
}


# Initialize PostHog only if enabled
if env.posthog.enabled:
    posthog.api_key = env.posthog.api_key
    posthog.host = env.posthog.api_url
    log.info("✓ PostHog enabled")
else:
    log.warn("✗ PostHog disabled")


async def _set_activation_property(
    distinct_id: str,
    property_name: str,
    request: Request,
) -> None:
    """
    Set a person property for user activation.
    Uses caching to ensure the property is only set once per user.
    Uses PostHog's $set_once to ensure idempotency.
    """
    if not distinct_id or not env.posthog.enabled:
        return

    project_id = getattr(request.state, "project_id", None)
    user_id = getattr(request.state, "user_id", None)

    if not project_id or not user_id:
        return

    # Check if we've already set this property for this user
    cache_key = {"property": property_name}

    already_set = await get_cache(
        project_id=project_id,
        user_id=user_id,
        namespace="posthog:activations",
        key=cache_key,
        retry=False,
    )

    if already_set:
        # Property already set, skip
        return

    try:
        # Set the property using PostHog's $set_once (idempotent)
        posthog.capture(
            distinct_id=distinct_id,
            event="$identify",
            properties={
                "$set_once": {
                    property_name: True,
                }
            },
        )

        # Mark in cache that we've set this property
        await set_cache(
            project_id=project_id,
            user_id=user_id,
            namespace="posthog:activations",
            key=cache_key,
            value=True,
            ttl=365 * 24 * 60 * 60,  # 1 year (effectively permanent)
        )

    except Exception as e:
        log.error(f"Error setting activation property '{property_name}': {e}")


def capture_oss_deployment_created(user_email: str, organization_id: str):
    """
    Captures the 'oss_deployment_created' event in PostHog.
    This event is triggered when the first user signs up in an OSS instance.
    No-op if PostHog is not configured.
    """

    if is_oss() and env.posthog.enabled:
        try:
            posthog.capture(
                distinct_id=user_email,
                event="oss_deployment_created",
                properties={
                    "organization_id": organization_id,
                    "deployment_type": "oss",
                },
            )
            log.info(f"Captured 'oss_deployment_created' event for {user_email}")
        except Exception as e:
            log.error(f"Error capturing 'oss_deployment_created' event: {e}")


async def analytics_middleware(request: Request, call_next: Callable):
    """Analytics middleware that no-ops if PostHog is disabled"""
    response = await call_next(request)

    # Skip analytics if PostHog is not configured
    if not env.posthog.enabled:
        return response

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
            _project_id = getattr(request.state, "project_id", None)
            _user_id = getattr(request.state, "user_id", None)

            if event_name in LIMITED_EVENTS_PER_AUTH and _project_id and _user_id:
                # --------------------------------------------------------------
                today = datetime.now().strftime("%Y-%m-%d")
                event_auth_key = f"{event_name}:{auth_method}"

                # Create a combined key for event+auth method tracking
                cache_key = {
                    "today": today,
                    "event_auth_key": event_auth_key,
                }

                current_count = await get_cache(
                    project_id=_project_id,
                    user_id=_user_id,
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
                    project_id=_project_id,
                    user_id=_user_id,
                    namespace="posthog:analytics",
                    key=cache_key,
                    value=current_count + 1,
                    ttl=24 * 60 * 60,  # 24 hours
                )
                # --------------------------------------------------------------

            distinct_id = None

            try:
                distinct_id = request.state.user_email
            except Exception:  # pylint: disable=bare-except
                pass

            if distinct_id and env.posthog.api_key:
                posthog.capture(
                    distinct_id=distinct_id,
                    event=event_name,
                    properties=properties or {},
                )

                # Check if this is an activation event
                if event_name in ACTIVATION_EVENTS:
                    property_name, allowed_auth_methods = ACTIVATION_EVENTS[event_name]

                    # Check if auth method is allowed for this activation
                    if (
                        allowed_auth_methods is None
                        or auth_method in allowed_auth_methods
                    ):
                        await _set_activation_property(
                            distinct_id=distinct_id,
                            property_name=property_name,
                            request=request,
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

    # <----------- Testsets Events ------------->
    if method == "POST" and "/testsets" in path:
        return "testset_created"

    elif method == "GET" and "/testsets" in path:
        return "testsets_fetched"

    elif method == "PUT" and "/testsets" in path:
        return "testset_updated"
    # <----------- End of Testsets Events ------------->

    # <----------- Evaluation Events ------------->
    if method == "POST" and "/evaluators/configs" in path:
        return "evaluator_created"

    elif method == "PUT" and "/evaluators/configs/" in path:
        return "evaluator_updated"

    elif method == "POST" and (
        path == "/preview/evaluations/runs/" or path == "/preview/simple/evaluations/"
    ):
        return "evaluation_created"

    # <----------- End of Evaluation Events ------------->

    # <----------- Observability Events ------------->
    if method == "POST" and "/otlp/v1/traces" in path:
        return "spans_created"

    elif method == "GET" and (
        "/tracing" in path or "/invocations" in path or "/annotations" in path
    ):
        return "spans_fetched"
    # <----------- End of Observability Events ------------->

    # <----------- Query/Prompt Management Events ------------->
    if method == "POST" and path == "/preview/queries/":
        return "query_created"

    elif method == "POST" and path == "/preview/simple/queries/":
        return "query_created"
    # <----------- End of Query/Prompt Management Events ------------->

    # <----------- User Lifecycle Events ------------->
    if method == "POST" and "invite" in path_parts:
        if "resend" in path_parts:
            return "invitation_created"
        if "accept" not in path_parts:
            return "user_invitation_sent_v1"
    # <----------- End of User Lifecycle Events ------------->

    return None
