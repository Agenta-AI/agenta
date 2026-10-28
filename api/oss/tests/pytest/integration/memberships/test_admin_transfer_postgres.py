"""The admin ownership transfer runs in one transaction under the membership lock."""

import pytest

import oss.src.services.db_manager as db_manager
from oss.tests.pytest.utils.membership_seed import (
    create_user,
    delete_seeded_organization,
    fetch_all,
    seed_organization,
)


pytestmark = pytest.mark.integration


async def _owner(organization_id):
    rows = await fetch_all(
        "SELECT owner_id FROM organizations WHERE id = :o", {"o": organization_id}
    )
    return rows[0]["owner_id"]


async def _project_rows(project_ids, user_id) -> dict:
    rows = await fetch_all(
        "SELECT project_id, role FROM project_members "
        "WHERE project_id = ANY(CAST(:p AS uuid[])) AND user_id = :u",
        {"p": list(project_ids), "u": user_id},
    )
    return {row["project_id"]: row["role"] for row in rows}


async def test_transfer_seeds_the_new_owner_and_swaps_roles():
    seeded = await seed_organization(
        members={"owner": "owner", "m": "admin"}, projects_per_workspace=2
    )
    owner, member = seeded.owner_id, seeded.user_ids["m"]
    try:
        await fetch_all(
            "DELETE FROM project_members WHERE user_id = :u AND project_id = :p "
            "RETURNING id",
            {"u": member, "p": seeded.project_ids[1]},
        )

        transferred = await db_manager.admin_transfer_ownership(
            org_ids=[seeded.organization_id],
            source_id=owner,
            target_id=member,
            workspace_ids=seeded.workspace_ids,
            project_ids=seeded.project_ids,
        )

        assert transferred == [seeded.organization_id]
        assert await _owner(seeded.organization_id) == member
        roles = await fetch_all(
            "SELECT user_id, role FROM organization_members WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        assert {r["user_id"]: r["role"] for r in roles} == {
            owner: "admin",
            member: "owner",
        }
        # Project 0: roles swapped; project 1: the missing row seeded as owner.
        assert await _project_rows(seeded.project_ids, member) == {
            seeded.project_ids[0]: "owner",
            seeded.project_ids[1]: "owner",
        }
    finally:
        await delete_seeded_organization(seeded)


async def test_transfer_to_a_non_member_changes_nothing():
    seeded = await seed_organization(members={"owner": "owner"})
    stranger = await create_user(label="stranger")
    seeded.extra_user_ids.append(stranger)
    try:
        transferred = await db_manager.admin_transfer_ownership(
            org_ids=[seeded.organization_id],
            source_id=seeded.owner_id,
            target_id=stranger,
            workspace_ids=seeded.workspace_ids,
            project_ids=seeded.project_ids,
        )

        assert transferred == []
        assert await _owner(seeded.organization_id) == seeded.owner_id
        assert await _project_rows(seeded.project_ids, stranger) == {}
    finally:
        await delete_seeded_organization(seeded)


async def test_a_failed_seed_rolls_back_the_whole_transfer(monkeypatch):
    seeded = await seed_organization(members={"owner": "owner", "m": "admin"})
    owner, member = seeded.owner_id, seeded.user_ids["m"]

    async def _failing_seed(*args, **kwargs):
        raise RuntimeError("injected")

    monkeypatch.setattr(db_manager, "admin_seed_owner_project_rows", _failing_seed)
    try:
        with pytest.raises(RuntimeError, match="injected"):
            await db_manager.admin_transfer_ownership(
                org_ids=[seeded.organization_id],
                source_id=owner,
                target_id=member,
                workspace_ids=seeded.workspace_ids,
                project_ids=seeded.project_ids,
            )

        assert await _owner(seeded.organization_id) == owner
        roles = await fetch_all(
            "SELECT user_id, role FROM organization_members WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        assert {r["user_id"]: r["role"] for r in roles} == {
            owner: "owner",
            member: "admin",
        }
    finally:
        await delete_seeded_organization(seeded)
