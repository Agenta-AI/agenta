import ast
from pathlib import Path


VERSIONS_DIR = (
    Path(__file__).resolve().parents[4]
    / "databases/postgres/migrations/tracing_oss/versions"
)


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
