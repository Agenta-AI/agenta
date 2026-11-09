"""The telemetry docs page must list exactly what each instance event sends."""

import re
from pathlib import Path

from oss.src.core.telemetry.heartbeat import InstanceHeartbeat
from oss.src.core.telemetry.service import INSTANCE_INSTALLED_PROPERTIES

DOCS_PAGE = (
    Path(__file__).resolve().parents[6]
    / "docs/docs/self-host/reference/03-telemetry.mdx"
)


def documented_fields(heading: str) -> set[str]:
    """The backticked names in the first column of the tables under `## <heading>`."""
    text = DOCS_PAGE.read_text()
    section = text.split(f"\n## {heading}\n", 1)[1].split("\n## ", 1)[0]
    return set(re.findall(r"^\| `([^`]+)` \|", section, flags=re.MULTILINE))


def test_install_ping_table_matches_the_payload():
    documented = documented_fields("Install ping")
    sent = set(INSTANCE_INSTALLED_PROPERTIES)

    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"
    assert not documented - sent, f"not in the payload: {sorted(documented - sent)}"


def test_heartbeat_table_matches_the_model():
    documented = documented_fields("Heartbeat")
    sent = set(InstanceHeartbeat.model_fields) | {"$groups"}

    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"
    assert not documented - sent, f"not in the payload: {sorted(documented - sent)}"
