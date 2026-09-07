import pytest
from starlette.requests import Request

from oss.src.middlewares.auth import _check_authentication_token
from oss.src.utils.exceptions import UnauthorizedException


def _request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix", ["", "/api"])
async def test_session_named_control_still_requires_project_auth(prefix):
    with pytest.raises(UnauthorizedException):
        await _check_authentication_token(_request(f"{prefix}/sessions/control/cancel"))


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix", ["", "/api"])
async def test_runner_command_outcome_route_remains_auth_exempt(prefix):
    await _check_authentication_token(
        _request(f"{prefix}/sessions/control/commands/command-id/outcome")
    )
