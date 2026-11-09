"""The telemetry docs page must list exactly what each instance event sends."""

import re
from pathlib import Path
from uuid import UUID

import pytest

from oss.src.core.telemetry import service as telemetry_service

DOCS_PAGE = (
    Path(__file__).resolve().parents[6]
    / "docs/docs/self-host/reference/03-telemetry.mdx"
)


def documented_fields(heading: str) -> set[str]:
    """The backticked names in the first column of the tables under `## <heading>`."""
    text = DOCS_PAGE.read_text()
    section = text.split(f"\n## {heading}\n", 1)[1].split("\n## ", 1)[0]
    return set(re.findall(r"^\| `([^`]+)` \|", section, flags=re.MULTILINE))


@pytest.mark.asyncio
async def test_install_ping_table_matches_the_payload_on_the_wire(monkeypatch):
    """Reads the properties the PostHog client really posts, library additions included."""
    batches = []
    monkeypatch.setattr(
        "posthog.client.batch_post",
        lambda api_key, host=None, **kwargs: batches.append(kwargs["batch"]),
    )
    telemetry_service._sync_client.cache_clear()
    instance_id = UUID("3f0c9a52-6d1e-4b8a-9f7e-2a5c8d4e1b07")

    await telemetry_service.capture(
        telemetry_service.INSTANCE_INSTALLED_EVENT,
        str(instance_id),
        dict(telemetry_service.INSTANCE_INSTALLED_PROPERTIES),
    )
    telemetry_service._sync_client.cache_clear()

    [[message]] = batches
    sent = set(message["properties"])
    documented = documented_fields("Install ping")
    assert not sent - documented, f"not on the docs page: {sorted(sent - documented)}"
    assert not documented - sent, f"not in the payload: {sorted(documented - sent)}"
