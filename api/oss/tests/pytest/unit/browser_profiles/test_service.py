from uuid import UUID

import pytest

from oss.src.core.browser_profiles.dtos import (
    BrowserProfile,
    BrowserProfileEdit,
    BrowserProfileState,
)
from oss.src.core.browser_profiles.service import BrowserProfilesService

PROJECT = UUID("00000000-0000-0000-0000-000000000001")
OWNER = UUID("00000000-0000-0000-0000-00000000000a")
PROFILE = UUID("00000000-0000-0000-0000-0000000000f1")


def _profile(**overrides) -> BrowserProfile:
    fields = {
        "id": PROFILE,
        "name": "Work",
        "allowed_hosts": ["example.com"],
        "state": BrowserProfileState.READY,
        "generation": 1,
        "created_by_id": OWNER,
    }
    return BrowserProfile(**{**fields, **overrides})


class _DAO:
    async def fetch_profile(self, **_):
        return _profile()

    async def edit_profile(self, *, name=None, allowed_hosts=None, **_):
        return _profile(**({"allowed_hosts": allowed_hosts} if allowed_hosts else {}))


class _Runner:
    def __init__(self):
        self.deleted = []

    async def delete(self, **kwargs):
        self.deleted.append(kwargs)


async def _edit(profile_edit: BrowserProfileEdit) -> _Runner:
    runner = _Runner()
    service = BrowserProfilesService(
        browser_profiles_dao=_DAO(),  # type: ignore[arg-type]
        workflows_service=object(),  # type: ignore[arg-type]
        runner_client=runner,  # type: ignore[arg-type]
        controller_client=object(),  # type: ignore[arg-type]
    )
    await service.edit_profile(
        project_id=PROJECT,
        user_id=OWNER,
        profile_id=PROFILE,
        profile_edit=profile_edit,
    )
    return runner


@pytest.mark.asyncio
async def test_changing_sites_stops_the_profiles_running_browsers():
    runner = await _edit(BrowserProfileEdit(allowed_hosts=["example.org"]))

    # The login's own browser, and every session browser of its owner (they may hold it).
    assert runner.deleted == [
        {"project_id": PROJECT, "label": str(PROFILE)},
        {"project_id": PROJECT, "label": f"user-{OWNER}"},
    ]


@pytest.mark.asyncio
async def test_a_rename_keeps_the_running_browsers():
    runner = await _edit(BrowserProfileEdit(name="Personal"))

    assert runner.deleted == []
