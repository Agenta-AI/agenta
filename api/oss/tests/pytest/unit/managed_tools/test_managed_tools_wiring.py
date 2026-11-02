"""Flag off is no change: the managed server is built only in EE with the wallet and the
mock switch on, and OSS never imports EE. Read as source: importing `routers.py` builds
every DAO, engine and router in the process."""

import ast
from pathlib import Path

API = Path(__file__).resolve().parents[5]
ROUTERS_PATH = API / "entrypoints" / "routers.py"
MANAGED_SOURCE = API / "oss" / "src" / "core" / "managed_tools"
MANAGED_ENTRY = (
    API / "oss" / "src" / "core" / "gateways" / "mcps" / "providers" / "managed"
)

_BUILT = {"ManagedMCPAdapter", "ManagedToolsService", "WalletManagedActionBilling"}


def test_the_managed_server_is_built_only_behind_both_flags():
    tree = ast.parse(ROUTERS_PATH.read_text(encoding="utf-8"))
    guarded = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        test = ast.unparse(node.test)
        if "env.wallets.enabled" in test and "env.mock_gateways.enabled" in test:
            for inner in ast.walk(node):
                if isinstance(inner, ast.Call):
                    guarded.add(ast.unparse(inner.func))
    constructed = {
        ast.unparse(node.func)
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and ast.unparse(node.func) in _BUILT
    }

    assert constructed == _BUILT
    assert constructed <= guarded
    # The gateway service receives the adapter, or None when a flag is off.
    assert "managed_tools=managed_mcp_adapter" in ROUTERS_PATH.read_text()
    assert "managed_mcp_adapter = None" in ROUTERS_PATH.read_text()


def test_no_managed_tools_module_imports_enterprise_code():
    offenders = []
    for root in (MANAGED_SOURCE, MANAGED_ENTRY):
        for path in root.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                modules = []
                if isinstance(node, ast.Import):
                    modules = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    modules = [node.module]
                if any(m == "ee" or m.startswith("ee.") for m in modules):
                    offenders.append(str(path))

    assert offenders == []
