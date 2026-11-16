import ast
from pathlib import Path


VERSIONS_DIR = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/tracing_oss/versions"
)

TURN_ID_MIGRATION = VERSIONS_DIR / "oss000000008_add_spans_turn_id.py"


def _revision_link(path: Path) -> tuple[str, str]:
    assignments = {}
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id in {"revision", "down_revision"}:
                assignments[node.target.id] = ast.literal_eval(node.value)
    return assignments["revision"], assignments["down_revision"]


def test_tracing_chain_has_one_head_after_turn_id_migration():
    links = dict(map(_revision_link, VERSIONS_DIR.glob("oss*.py")))

    heads = set(links) - set(links.values())

    assert links["oss000000008"] == "oss000000007"
    assert heads == {"oss000000008"}


def test_turn_id_migration_builds_the_partial_index_concurrently():
    source = TURN_ID_MIGRATION.read_text()

    assert "SET LOCAL lock_timeout" in source
    assert "ADD COLUMN IF NOT EXISTS turn_id VARCHAR" in source
    assert "autocommit_block()" in source
    assert "DROP INDEX CONCURRENTLY IF EXISTS" in source
    assert "CREATE INDEX CONCURRENTLY" in source
    assert "WHERE turn_id IS NOT NULL" in source
