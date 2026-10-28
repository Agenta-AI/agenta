"""The workflow-invocation claims a gateway caller presents, read in one place.

The auth middleware reads these off the audience-bound gateway credential the SDK
exchanges for a run and puts them on request state. A caller holding a session cookie or
an API key carries no such credential and belongs to no run, so both accessors answer
`None` for them rather than inventing something.

They take a `Request` rather than reading the auth context var because the middleware
deliberately keeps run claims off the tenant scope: `gateway_run_id` and `gateway_tools`
are signed claims about one invocation, not general-purpose authorization attributes.
Reading them through one pair of accessors is what keeps the four call sites agreeing on
what counts as present — an empty string is not a run, and a non-list is not a tool set.
"""

from typing import Any, Dict, List, Optional

from fastapi import Request

GATEWAY_RUN_LABEL_KEYS = ("session_id", "agent_id")


def gateway_run_id(request: Optional[Request]) -> Optional[str]:
    """The workflow invocation this call belongs to, if the caller is on one."""
    if request is None:
        return None
    value = getattr(request.state, "gateway_run_id", None)
    return value if isinstance(value, str) and value else None


def gateway_run_labels(request: Optional[Request]) -> Optional[Dict[str, str]]:
    """The session and agent the presenting credential names, for the usage record only.

    Supplied by the runtime that exchanged the credential, so they label a call and never
    authorize one: a caller can only name them on its own tenant's usage. The one thing a
    session label changes is spend admission: a platform-funded call that names a session
    whose turn the runner admitted is not refused for the balance until that turn ends
    (`WalletSpendAdmission`), which a caller can only reach in its own organization.
    """
    if request is None:
        return None
    value = getattr(request.state, "gateway_run_labels", None)
    if not isinstance(value, dict):
        return None
    labels = {
        key: value[key]
        for key in GATEWAY_RUN_LABEL_KEYS
        if isinstance(value.get(key), str) and value[key]
    }
    return labels or None


def gateway_tools(request: Optional[Request]) -> Optional[List[Any]]:
    """The callback tools the presenting credential already carries, if any.

    Descriptors are not validated here. What a tool descriptor must look like differs
    between the route that narrows a credential and the adapter that serves one, so each
    applies its own rule to the list this returns.
    """
    if request is None:
        return None
    value = getattr(request.state, "gateway_tools", None)
    return value if isinstance(value, list) else None


def gateway_platform_run(request: Optional[Request]) -> bool:
    """Whether the presenting credential was issued to the platform's own agent runtime.

    Only exactly `True` counts: a missing, false or non-boolean claim, and every principal
    that is not a gateway token, answer False.
    """
    if request is None:
        return False
    return getattr(request.state, "gateway_platform_run", None) is True


def gateway_bindings(request: Optional[Request]) -> List[Dict[str, Any]]:
    """The presenting credential's signed `caller_account` bindings (M7), in token form,
    for a route that re-mints the credential: a narrowed credential keeps the run's
    bindings, never more. Empty for every caller that is not a run."""
    if request is None:
        return []
    from oss.src.core.credentials.bindings import claims_to_token  # noqa: PLC0415

    return claims_to_token(getattr(request.state, "gateway_bindings", None) or ())
