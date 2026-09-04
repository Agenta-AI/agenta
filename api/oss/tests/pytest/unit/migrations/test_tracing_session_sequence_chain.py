import ast
from pathlib import Path


VERSIONS_DIR = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/tracing_oss/versions"
)
WATCHDOG_REVISION = ("oss000000005", "oss000000004")


def _revision_link(path: Path) -> tuple[str, str]:
    assignments = {}
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id in {"revision", "down_revision"}:
                assignments[node.target.id] = ast.literal_eval(node.value)
    return assignments["revision"], assignments["down_revision"]


def test_tracing_chain_has_one_head_with_watchdog_migration():
    session_migration = VERSIONS_DIR / "oss000000006_add_session_sequence_cursors.py"
    links = {
        WATCHDOG_REVISION[0]: WATCHDOG_REVISION[1],
        _revision_link(session_migration)[0]: _revision_link(session_migration)[1],
    }

    heads = set(links) - set(links.values())

    assert links == {
        "oss000000005": "oss000000004",
        "oss000000006": "oss000000005",
    }
    assert heads == {"oss000000006"}
