"""MCP endpoint queries keep valid rows when stored data cannot be mapped."""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from oss.src.core.gateways.mcps.dtos import MCPAuthScheme
from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
from oss.src.dbs.postgres.gateways.mcps.dbes import MCPEndpointDBE
from oss.src.dbs.postgres.shared.engine import TransactionsEngine

pytestmark = pytest.mark.asyncio


def _row(*, project_id: UUID, slug: str) -> MCPEndpointDBE:
    return MCPEndpointDBE(
        id=uuid4(),
        project_id=project_id,
        slug=slug,
        name=slug,
        auth_mode=MCPAuthScheme.NONE,
        data={"route": {"base_url": "https://mcp.example.com"}},
        flags={"is_active": True, "is_valid": True},
    )


def _dao_with_rows(rows: list[MCPEndpointDBE]) -> MCPEndpointsDAO:
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    session = AsyncMock()
    session.execute.return_value = result
    engine = MagicMock(spec=TransactionsEngine)
    engine.session.return_value.__aenter__.return_value = session
    return MCPEndpointsDAO(engine=engine)


async def test_query_keeps_valid_rows_before_and_after_an_invalid_row():
    project_id = uuid4()
    first = _row(project_id=project_id, slug="first")
    invalid = _row(project_id=project_id, slug="invalid")
    invalid.data = {"route": "invalid-route"}
    last = _row(project_id=project_id, slug="last")
    dao = _dao_with_rows([first, invalid, last])

    endpoints = await dao.query_endpoints(project_id=project_id)

    assert [endpoint.id for endpoint in endpoints] == [first.id, last.id]
    assert [endpoint.data.route.base_url for endpoint in endpoints] == [
        "https://mcp.example.com",
        "https://mcp.example.com",
    ]


@pytest.mark.parametrize(
    "field,value,error_type",
    [
        ("data", {"route": "sensitive-input-value"}, "ValidationError"),
        ("data", ["sensitive-input-value"], "TypeError"),
        ("flags", {"is_valid": "sensitive-input-value"}, "ValidationError"),
        ("status", {"timestamp": "sensitive-input-value"}, "ValidationError"),
        ("auth_mode", "sensitive-input-value", "ValidationError"),
    ],
)
async def test_query_logs_each_invalid_row_without_its_stored_input(
    field, value, error_type, caplog
):
    project_id = uuid4()
    first_invalid = _row(project_id=project_id, slug="first-invalid")
    valid = _row(project_id=project_id, slug="valid")
    last_invalid = _row(project_id=project_id, slug="last-invalid")
    for row in [first_invalid, last_invalid]:
        setattr(row, field, value)
    dao = _dao_with_rows([first_invalid, valid, last_invalid])

    endpoints = await dao.query_endpoints(project_id=project_id)

    assert [endpoint.id for endpoint in endpoints] == [valid.id]
    warnings = [record for record in caplog.records if record.levelname == "WARNING"]
    assert len(warnings) == 2
    for warning, invalid in zip(warnings, [first_invalid, last_invalid]):
        message = warning.getMessage()
        assert str(project_id) in message
        assert str(invalid.id) in message
        assert error_type in message
        assert warning.exc_info is None
    assert "sensitive-input-value" not in caplog.text


@pytest.mark.parametrize("has_invalid_row", [False, True])
async def test_query_returns_empty_when_no_valid_rows_remain(has_invalid_row):
    project_id = uuid4()
    rows = []
    if has_invalid_row:
        invalid = _row(project_id=project_id, slug="invalid")
        invalid.data = {"route": "invalid-route"}
        rows.append(invalid)
    dao = _dao_with_rows(rows)

    assert await dao.query_endpoints(project_id=project_id) == []
