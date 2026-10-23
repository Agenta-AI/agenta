"""Boundaries of the strict `check_action_access` (M2, interfaces 3.3).

The wrapper raises without request access and for another user. These tests pin the
code paths that run without the auth middleware (they must not call the wrapper) and
the callers that run inside a request (they must pass the request's user).
"""

import ast
import inspect
import textwrap
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

import oss.src.core.access.service as access_module
from oss.src.core.access.context import (
    get_request_access,
    reset_request_access,
    set_request_access,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.middlewares import auth as auth_module
from oss.tests.pytest.utils.principals import (
    AllowingAccessService,
    make_envelope,
    make_request_access,
)


API_ROOT = Path(__file__).resolve().parents[5]


def _source(function) -> str:
    return textwrap.dedent(inspect.getsource(function))


def _calls_wrapper(function) -> bool:
    tree = ast.parse(_source(function))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name == "check_action_access":
                return True
    return False


# -- paths that run without request access -------------------------------------------


def test_mcp_connect_callback_checks_the_attempt_user_without_request_access():
    from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter

    callback = MCPGatewayRouter.connect_callback
    assert not _calls_wrapper(callback)
    assert "check_human(" in _source(callback)
    assert "attempt.user_id" in _source(callback)


async def test_admin_access_token_request_sets_no_request_access(monkeypatch):
    monkeypatch.setattr(auth_module, "_SECRET_KEY", "admin-secret")
    request = SimpleNamespace(state=SimpleNamespace())
    await auth_module.verify_access_token(request, "admin-secret")
    assert request.state.admin is True
    assert auth_module._build_request_access_from_state(request) is None
    assert get_request_access() is None


def test_tools_connection_callback_does_not_call_the_wrapper():
    from oss.src.apis.fastapi.tools.router import ToolsRouter

    assert not _calls_wrapper(ToolsRouter.callback_connection)


def test_slack_install_callback_does_not_call_the_wrapper():
    from oss.src.apis.fastapi.channels.router import ChannelsRouter

    assert not _calls_wrapper(ChannelsRouter.slack_install_callback)


def test_runner_outcome_routes_do_not_call_the_wrapper():
    from oss.src.apis.fastapi.sessions.router import SessionControlRouter
    from oss.src.apis.fastapi.vault.router import VaultRouter

    assert not _calls_wrapper(SessionControlRouter.report_command_outcome)
    assert not _calls_wrapper(VaultRouter.report_subscription_login_outcome)


# -- callers inside a request ---------------------------------------------------------


async def test_gateway_policy_authorize_passes_the_request_user(monkeypatch):
    """Under a run credential the gateway scope's user is the request's acting user,
    so the wrapper decides for the request principal and does not raise."""

    from oss.src.core.gateways.policy.service import GatewayPolicyService
    from oss.src.utils.context import AuthScope

    service = AllowingAccessService()
    monkeypatch.setattr(access_module, "_access_service", service)
    project_id = uuid4()
    access = make_request_access(
        envelope=make_envelope(kind="api_key", project_id=project_id),
        credential_kind="run_credential",
    )
    scope = AuthScope(
        organization_id=access.authority.organization_id,
        workspace_id=uuid4(),
        project_id=project_id,
        user_id=access.acting_user_id,
    )
    policy = GatewayPolicyService(resolver=SimpleNamespace())
    token = set_request_access(access)
    try:
        decision = await policy.authorize(
            scope=scope,
            permission=Permission.RUN_WORKFLOWS,
            target=SimpleNamespace(),
        )
    finally:
        reset_request_access(token)

    assert decision.allowed is True
    assert service.decisions[-1]["access"] == access
    assert service.decisions[-1]["project_id"] == project_id


_REQUEST_USER = {
    "request.state.user_id",
    "str(request.state.user_id)",
}


def _wrapper_user_args(path: Path):
    """Every `check_action_access(user_uid=...)` argument in a file, with the
    assignments of the local names it uses in the enclosing function."""

    tree = ast.parse(path.read_text())
    for function in ast.walk(tree):
        if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        locals_from = {}
        for node in ast.walk(function):
            if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None:
                targets = (
                    node.targets if isinstance(node, ast.Assign) else [node.target]
                )
                for target in targets:
                    if isinstance(target, ast.Name):
                        locals_from[target.id] = ast.unparse(node.value)
        for node in ast.walk(function):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name != "check_action_access":
                continue
            for keyword in node.keywords:
                if keyword.arg == "user_uid":
                    yield function.name, ast.unparse(keyword.value), locals_from


def _is_request_user(expression: str, locals_from: dict) -> bool:
    if expression in _REQUEST_USER:
        return True
    inner = expression[4:-1] if expression.startswith("str(") else expression
    source = locals_from.get(inner)
    return source is not None and _is_request_user(source, locals_from)


def test_sessions_router_wrapper_calls_pass_the_request_user():
    path = API_ROOT / "oss/src/apis/fastapi/sessions/router.py"
    calls = list(_wrapper_user_args(path))
    assert calls
    wrong = [
        (function, expression)
        for function, expression, locals_from in calls
        if not _is_request_user(expression, locals_from)
    ]
    assert wrong == []


# The reviewed list (plan Task 11 Step 3): callers whose `user_uid` is not literally
# `request.state.user_id`. Each one passes the request's acting user: the auth scope's
# user (set from `request.state.user_id` by the middleware), or a parameter that its
# route fills from `request.state.user_id`.
_REVIEWED = {
    ("oss/src/apis/fastapi/environments/utils.py", "str(user_id)"),
    ("oss/src/apis/fastapi/gateways/llms/router.py", "str(scope.user_id)"),
    ("oss/src/apis/fastapi/gateways/mcps/router.py", "str(scope.user_id)"),
    ("oss/src/core/gateways/policy/service.py", "str(scope.user_id)"),
}


@pytest.mark.parametrize("root", ["oss/src", "ee/src", "entrypoints"])
def test_every_wrapper_caller_passes_the_request_user_or_is_reviewed(root):
    base = API_ROOT / root
    if not base.exists():
        pytest.skip(f"{root} is not in this checkout")
    unreviewed = []
    for path in base.rglob("*.py"):
        relative = str(path.relative_to(API_ROOT))
        for function, expression, locals_from in _wrapper_user_args(path):
            if _is_request_user(expression, locals_from):
                continue
            if (relative, expression) in _REVIEWED:
                continue
            unreviewed.append((relative, function, expression))
    assert unreviewed == []
