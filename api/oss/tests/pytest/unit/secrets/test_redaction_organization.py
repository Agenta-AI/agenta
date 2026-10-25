"""Redaction of organization rows (M5, Task 8, P1)."""

from uuid import uuid4

import pytest

from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.redaction import (
    CREDENTIAL_FIELDS,
    inherited_secret_response,
    organization_secret_response,
    project_secret_response,
)
from oss.tests.pytest.utils.organization_secrets import SENTINEL_KEY

ORGANIZATION = uuid4()


def _row(kind: str) -> SecretResponseDTO:
    if kind == "provider_key":
        data = {"kind": "openai", "provider": {"key": SENTINEL_KEY}}
    else:
        data = {
            "kind": "custom",
            "provider": {
                "url": "https://llm.example.com/v1",
                "key": SENTINEL_KEY,
                "extras": {"api_key": SENTINEL_KEY, "region": "eu"},
            },
            "models": [{"slug": "m"}],
        }
    return SecretResponseDTO.model_validate(
        {
            "id": str(uuid4()),
            "slug": "company",
            "kind": kind,
            "data": data,
            "header": {"name": "Company"},
            "write_only": False,
            "owner": {"kind": "organization", "id": str(ORGANIZATION)},
            "availability": "selected_projects",
            "selected_project_ids": [str(uuid4())],
        }
    )


INHERITABLE = ["provider_key", "custom_provider"]


@pytest.mark.parametrize("kind", INHERITABLE)
def test_project_secret_response_never_reveals_an_organization_row(kind):
    assert kind in CREDENTIAL_FIELDS
    projected = project_secret_response(_row(kind), reveal_write_only=True)
    dumped = projected.model_dump_json()
    assert SENTINEL_KEY not in dumped
    assert projected.write_only is True


@pytest.mark.parametrize("kind", INHERITABLE)
def test_no_preview_on_organization_rows(kind):
    for projected in (
        project_secret_response(_row(kind), reveal_write_only=False),
        organization_secret_response(_row(kind)),
        inherited_secret_response(_row(kind)),
    ):
        assert projected.value_status.preview is None
        assert projected.value_status.configured is True


@pytest.mark.parametrize("kind", INHERITABLE)
def test_inherited_projection_drops_values_and_other_project_ids(kind):
    override = uuid4()
    projected = inherited_secret_response(_row(kind), overridden_by_secret_id=override)
    dumped = projected.model_dump_json(exclude_none=True)
    assert SENTINEL_KEY not in dumped
    assert projected.availability is None and projected.selected_project_ids is None
    assert projected.overridden_by_secret_id == override
    if kind == "custom_provider":
        # The non-credential fields stay (the base URL, the models, a region extra).
        assert projected.data.provider.url == "https://llm.example.com/v1"
        assert projected.data.provider.extras == {"region": "eu"}


@pytest.mark.parametrize("kind", INHERITABLE)
def test_organization_projection_keeps_availability_and_selected_projects(kind):
    row = _row(kind)
    projected = organization_secret_response(row)
    assert SENTINEL_KEY not in projected.model_dump_json()
    assert projected.availability == row.availability
    assert projected.selected_project_ids == row.selected_project_ids
