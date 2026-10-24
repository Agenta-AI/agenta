"""The organization layout of a mount prefix, and the per-mount predicate.

From 0.125.0 a new mount stores `mounts/<organization_id>/<mount_id>`; older mounts keep
`mounts/<project_id>/<mount_id>`. `is_organization_keyed` says which layout one row has.
"""

from uuid import uuid4

from oss.src.core.mounts.dtos import Mount
from oss.src.core.mounts.service import is_organization_keyed
from oss.src.core.mounts.types import organization_storage_prefix


def _mount(*, mount_id, storage_prefix: str) -> Mount:
    return Mount(
        id=mount_id,
        project_id=uuid4(),
        slug=f"s-{uuid4().hex[:8]}",
        storage_prefix=storage_prefix,
    )


def test_organization_storage_prefix_has_no_namespace_and_no_trailing_slash():
    organization_id, mount_id = uuid4(), uuid4()

    assert organization_storage_prefix(
        organization_id=organization_id,
        mount_id=mount_id,
    ) == (f"mounts/{organization_id}/{mount_id}")


def test_is_organization_keyed_for_the_organization_layout():
    organization_id, mount_id = uuid4(), uuid4()
    mount = _mount(
        mount_id=mount_id,
        storage_prefix=f"mounts/{organization_id}/{mount_id}",
    )

    assert is_organization_keyed(mount=mount, organization_id=organization_id)


def test_is_organization_keyed_for_the_project_layout():
    organization_id, project_id, mount_id = uuid4(), uuid4(), uuid4()
    mount = _mount(
        mount_id=mount_id,
        storage_prefix=f"mounts/{project_id}/{mount_id}",
    )

    assert not is_organization_keyed(mount=mount, organization_id=organization_id)


def test_is_organization_keyed_for_a_malformed_prefix():
    organization_id, mount_id = uuid4(), uuid4()
    mount = _mount(
        mount_id=mount_id,
        storage_prefix=f"mounts/{organization_id}/{mount_id}/extra",
    )

    assert not is_organization_keyed(mount=mount, organization_id=organization_id)


def test_is_organization_keyed_for_another_organization():
    organization_id, other_organization_id, mount_id = uuid4(), uuid4(), uuid4()
    mount = _mount(
        mount_id=mount_id,
        storage_prefix=f"mounts/{other_organization_id}/{mount_id}",
    )

    assert not is_organization_keyed(mount=mount, organization_id=organization_id)


def test_is_organization_keyed_for_another_mount_id():
    organization_id, mount_id, other_mount_id = uuid4(), uuid4(), uuid4()
    mount = _mount(
        mount_id=mount_id,
        storage_prefix=f"mounts/{organization_id}/{other_mount_id}",
    )

    assert not is_organization_keyed(mount=mount, organization_id=organization_id)
