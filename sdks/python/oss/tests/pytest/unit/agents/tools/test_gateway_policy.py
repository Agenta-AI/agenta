"""The gateway permission compiler (qa.md C1 to C19, C25, C26).

The compiler is a pure function, so its truth table belongs here and not in a live agent
run. Every case names the qa.md ID it covers.
"""

from __future__ import annotations

from typing import Optional, get_args

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.tools import (
    CatalogToolInfo,
    CompiledGatewayPolicy,
    GatewayPermission,
    GatewayPermissions,
    compile_gateway_permissions,
)
from agenta.sdk.agents.tools.models import PermissionMode

_KEY = "GET_ISSUE"
# Read from the type rather than restated, so a fifth mode cannot leave every "any" row
# below silently untested while the table still reads as exhaustive.
_ALL_MODES: tuple[PermissionMode, ...] = get_args(PermissionMode)
_ALL_READ_ONLY: tuple[Optional[bool], ...] = (True, False, None)


def _compile(
    *,
    entry: Optional[GatewayPermission],
    default: GatewayPermission,
    mode: PermissionMode,
    read_only: Optional[bool] = None,
) -> CompiledGatewayPolicy:
    """Compile one catalog tool, `_KEY`, under one saved policy."""
    policy = GatewayPermissions(
        default=default,
        tools={} if entry is None else {_KEY: entry},
    )
    return compile_gateway_permissions(
        policy,
        [CatalogToolInfo(key=_KEY, read_only=read_only)],
        mode,
    )


# --- C13: the case the format exists for -------------------------------------------


def test_absent_key_and_explicit_inherit_differ_under_a_deny_default():
    # C13, against C3. An absent key uses the connection default; an explicit `inherit`
    # skips it and reaches the agent-wide mode, so the read runs under a `deny` default.
    # If these ever agree, the fourth permission value has stopped meaning anything.
    absent = _compile(entry=None, default="deny", mode="allow_reads", read_only=True)
    inherited = _compile(
        entry="inherit", default="deny", mode="allow_reads", read_only=True
    )
    assert absent.tools[_KEY].permission == "deny"
    assert inherited.tools[_KEY].permission == "allow"


# --- C1 to C17: the truth table ----------------------------------------------------

# (qa.md ID, entry, default, modes, read_only values, expected). A row listing every mode
# or every read_only value is a qa.md "any" cell, so it must hold for all of them.
_TRUTH_TABLE = [
    ("C1", None, "allow", _ALL_MODES, _ALL_READ_ONLY, "allow"),
    ("C2", None, "ask", _ALL_MODES, _ALL_READ_ONLY, "ask"),
    ("C3", None, "deny", _ALL_MODES, _ALL_READ_ONLY, "deny"),
    ("C4", None, "inherit", ("allow",), _ALL_READ_ONLY, "allow"),
    ("C5", None, "inherit", ("ask",), _ALL_READ_ONLY, "ask"),
    ("C6", None, "inherit", ("deny",), _ALL_READ_ONLY, "deny"),
    ("C7", None, "inherit", ("allow_reads",), (True,), "allow"),
    ("C8", None, "inherit", ("allow_reads",), (False,), "ask"),
    ("C9", None, "inherit", ("allow_reads",), (None,), "ask"),
    ("C10", "allow", "deny", _ALL_MODES, _ALL_READ_ONLY, "allow"),
    ("C11", "ask", "allow", _ALL_MODES, _ALL_READ_ONLY, "ask"),
    ("C12", "deny", "allow", _ALL_MODES, _ALL_READ_ONLY, "deny"),
    ("C13", "inherit", "deny", ("allow_reads",), (True,), "allow"),
    ("C14", "inherit", "deny", ("allow_reads",), (False,), "ask"),
    ("C15", "inherit", "deny", ("allow_reads",), (None,), "ask"),
    ("C16", "inherit", "deny", ("deny",), _ALL_READ_ONLY, "deny"),
    ("C17", "inherit", "allow", ("ask",), _ALL_READ_ONLY, "ask"),
]


def _truth_table_cases():
    for case_id, entry, default, modes, read_only_values, expected in _TRUTH_TABLE:
        for mode in modes:
            for read_only in read_only_values:
                yield pytest.param(
                    entry,
                    default,
                    mode,
                    read_only,
                    expected,
                    id=f"{case_id}-{mode}-read_only={read_only}",
                )


@pytest.mark.parametrize(
    ("entry", "default", "mode", "read_only", "expected"),
    list(_truth_table_cases()),
)
def test_permission_resolution_truth_table(entry, default, mode, read_only, expected):
    compiled = _compile(entry=entry, default=default, mode=mode, read_only=read_only)
    assert compiled.tools[_KEY].permission == expected


# --- C18, C19, C25, C26 ------------------------------------------------------------


def test_compiled_values_are_never_inherit():
    # C18. `inherit` is resolved here and never crosses the boundary to the runner.
    policy = GatewayPermissions(
        default="inherit",
        tools={"CREATE_ISSUE": "inherit", "DELETE_REPOSITORY": "deny"},
    )
    compiled = compile_gateway_permissions(
        policy,
        [
            CatalogToolInfo(key="GET_ISSUE", read_only=True),
            CatalogToolInfo(key="CREATE_ISSUE", read_only=False),
            CatalogToolInfo(key="DELETE_REPOSITORY", read_only=False),
        ],
        "allow_reads",
    )
    assert {tool.permission for tool in compiled.tools.values()} <= {
        "allow",
        "ask",
        "deny",
    }
    assert compiled.tools["GET_ISSUE"].permission == "allow"
    assert compiled.tools["CREATE_ISSUE"].permission == "ask"


def test_configured_key_missing_from_the_catalog_is_stale_not_executable():
    # C19. The authored intent stays visible for the authoring surface, but a key the
    # catalog no longer carries never becomes an executable tool.
    policy = GatewayPermissions(
        default="deny",
        tools={"GET_ISSUE": "allow", "RETIRED_TOOL": "allow"},
    )
    compiled = compile_gateway_permissions(
        policy,
        [CatalogToolInfo(key="GET_ISSUE", read_only=True)],
        "allow_reads",
    )
    assert set(compiled.tools) == {"GET_ISSUE"}
    assert compiled.stale_keys == ["RETIRED_TOOL"]


def test_a_catalog_tool_added_after_saving_uses_the_connection_default():
    # C25. The saved entry names no key for the new tool, so it takes the default.
    compiled = compile_gateway_permissions(
        GatewayPermissions(default="ask"),
        [
            CatalogToolInfo(key=_KEY, read_only=True),
            CatalogToolInfo(key="BRAND_NEW_TOOL", read_only=True),
        ],
        "allow",
    )
    assert compiled.tools["BRAND_NEW_TOOL"].permission == "ask"
    assert compiled.stale_keys == []


def test_a_read_only_hint_never_overrides_an_authored_deny():
    # C26, a security rule. Catalog metadata is provider input; it decides nothing when
    # the author wrote an explicit permission.
    for mode in _ALL_MODES:
        compiled = _compile(entry="deny", default="allow", mode=mode, read_only=True)
        assert compiled.tools[_KEY].permission == "deny", mode


def test_compiled_tools_carry_the_tri_state_read_only_hint():
    # The resolved policy in contracts section 5 needs the hint per tool, and unknown must
    # stay distinct from a write for the approval card and the logs.
    compiled = compile_gateway_permissions(
        GatewayPermissions(default="allow"),
        [
            CatalogToolInfo(key="READ", read_only=True),
            CatalogToolInfo(key="WRITE", read_only=False),
            CatalogToolInfo(key="UNKNOWN"),
        ],
        "allow",
    )
    assert compiled.tools["READ"].read_only is True
    assert compiled.tools["WRITE"].read_only is False
    assert compiled.tools["UNKNOWN"].read_only is None


@pytest.mark.parametrize("read_only", ["yes", "true", 1, 0, "", []])
def test_a_non_boolean_read_only_hint_is_rejected(read_only):
    # The hint arrives from a provider catalog over HTTP. A lenient bool would read "yes"
    # or 1 as `True`, and under `inherit` plus `allow_reads` that turns a malformed
    # classification into a tool that runs with no prompt.
    with pytest.raises(ValidationError):
        CatalogToolInfo(key="GET_ISSUE", read_only=read_only)


def test_an_empty_catalog_compiles_to_nothing_executable():
    compiled = compile_gateway_permissions(
        GatewayPermissions(default="allow", tools={"GET_ISSUE": "allow"}),
        [],
        "allow",
    )
    assert compiled.tools == {}
    assert compiled.stale_keys == ["GET_ISSUE"]
