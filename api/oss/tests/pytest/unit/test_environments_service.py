from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from oss.src.core.environments.dtos import (
    EnvironmentRevisionCommit,
    EnvironmentRevisionData,
)
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.git.dtos import Revision
from oss.src.core.shared.dtos import Reference


@pytest.mark.asyncio
async def test_commit_environment_revision_publishes_state_and_grouped_diff():
    project_id = uuid4()
    user_id = uuid4()
    environment_id = uuid4()
    variant_id = uuid4()
    previous_revision_id = uuid4()
    current_revision_id = uuid4()

    unchanged_refs = {
        "application": Reference(id=uuid4(), slug="keep-app"),
        "application_variant": Reference(id=uuid4(), slug="keep-variant"),
        "application_revision": Reference(
            id=uuid4(),
            slug="keep-revision",
            version="v1",
        ),
    }
    old_updated_refs = {
        "application": Reference(id=uuid4(), slug="update-app"),
        "application_variant": Reference(id=uuid4(), slug="update-variant"),
        "application_revision": Reference(
            id=uuid4(),
            slug="update-revision",
            version="v1",
        ),
    }
    new_updated_refs = {
        "application": old_updated_refs["application"],
        "application_variant": old_updated_refs["application_variant"],
        "application_revision": Reference(
            id=uuid4(),
            slug="update-revision",
            version="v2",
        ),
    }
    deleted_refs = {
        "application": Reference(id=uuid4(), slug="delete-app"),
        "application_variant": Reference(id=uuid4(), slug="delete-variant"),
        "application_revision": Reference(
            id=uuid4(),
            slug="delete-revision",
            version="v1",
        ),
    }
    created_refs = {
        "application": Reference(id=uuid4(), slug="create-app"),
        "application_variant": Reference(id=uuid4(), slug="create-variant"),
        "application_revision": Reference(
            id=uuid4(),
            slug="create-revision",
            version="v1",
        ),
    }

    previous_revision = Revision(
        id=previous_revision_id,
        slug="prev",
        version="v1",
        artifact_id=environment_id,
        variant_id=variant_id,
        data=EnvironmentRevisionData(
            references={
                "keep.revision": unchanged_refs,
                "update.revision": old_updated_refs,
                "delete.revision": deleted_refs,
            }
        ).model_dump(mode="json", exclude_none=True),
    )
    committed_revision = Revision(
        id=current_revision_id,
        slug="curr",
        version="v2",
        artifact_id=environment_id,
        variant_id=variant_id,
        data=EnvironmentRevisionData(
            references={
                "keep.revision": unchanged_refs,
                "update.revision": new_updated_refs,
                "create.revision": created_refs,
            }
        ).model_dump(mode="json", exclude_none=True),
    )

    environments_dao = MagicMock()
    environments_dao.query_revisions = AsyncMock(return_value=[previous_revision])
    environments_dao.commit_revision = AsyncMock(return_value=committed_revision)

    service = EnvironmentsService(environments_dao=environments_dao)
    commit = EnvironmentRevisionCommit(
        slug="curr",
        environment_id=environment_id,
        environment_variant_id=variant_id,
        data=EnvironmentRevisionData(
            references={
                "keep.revision": unchanged_refs,
                "update.revision": new_updated_refs,
                "create.revision": created_refs,
            }
        ),
    )

    with patch(
        "oss.src.core.environments.service.publish_event",
        new=AsyncMock(),
    ) as publish_event:
        await service.commit_environment_revision(
            project_id=project_id,
            user_id=user_id,
            environment_revision_commit=commit,
        )

    publish_event.assert_awaited_once()
    event = publish_event.await_args.kwargs["event"]
    attributes = event.attributes

    assert attributes["state"] == {
        "references": {
            "keep.revision": {
                "application": {
                    "id": str(unchanged_refs["application"].id),
                    "slug": "keep-app",
                },
                "application_variant": {
                    "id": str(unchanged_refs["application_variant"].id),
                    "slug": "keep-variant",
                },
                "application_revision": {
                    "id": str(unchanged_refs["application_revision"].id),
                    "slug": "keep-revision",
                    "version": "v1",
                },
            },
            "update.revision": {
                "application": {
                    "id": str(old_updated_refs["application"].id),
                    "slug": "update-app",
                },
                "application_variant": {
                    "id": str(old_updated_refs["application_variant"].id),
                    "slug": "update-variant",
                },
                "application_revision": {
                    "id": str(new_updated_refs["application_revision"].id),
                    "slug": "update-revision",
                    "version": "v2",
                },
            },
            "create.revision": {
                "application": {
                    "id": str(created_refs["application"].id),
                    "slug": "create-app",
                },
                "application_variant": {
                    "id": str(created_refs["application_variant"].id),
                    "slug": "create-variant",
                },
                "application_revision": {
                    "id": str(created_refs["application_revision"].id),
                    "slug": "create-revision",
                    "version": "v1",
                },
            },
        }
    }
    assert attributes["diff"] == {
        "created": {
            "create.revision": {
                "new": {
                    "application": {
                        "id": str(created_refs["application"].id),
                        "slug": "create-app",
                    },
                    "application_variant": {
                        "id": str(created_refs["application_variant"].id),
                        "slug": "create-variant",
                    },
                    "application_revision": {
                        "id": str(created_refs["application_revision"].id),
                        "slug": "create-revision",
                        "version": "v1",
                    },
                }
            }
        },
        "updated": {
            "update.revision": {
                "old": {
                    "application": {
                        "id": str(old_updated_refs["application"].id),
                        "slug": "update-app",
                    },
                    "application_variant": {
                        "id": str(old_updated_refs["application_variant"].id),
                        "slug": "update-variant",
                    },
                    "application_revision": {
                        "id": str(old_updated_refs["application_revision"].id),
                        "slug": "update-revision",
                        "version": "v1",
                    },
                },
                "new": {
                    "application": {
                        "id": str(old_updated_refs["application"].id),
                        "slug": "update-app",
                    },
                    "application_variant": {
                        "id": str(old_updated_refs["application_variant"].id),
                        "slug": "update-variant",
                    },
                    "application_revision": {
                        "id": str(new_updated_refs["application_revision"].id),
                        "slug": "update-revision",
                        "version": "v2",
                    },
                },
            }
        },
        "deleted": {
            "delete.revision": {
                "old": {
                    "application": {
                        "id": str(deleted_refs["application"].id),
                        "slug": "delete-app",
                    },
                    "application_variant": {
                        "id": str(deleted_refs["application_variant"].id),
                        "slug": "delete-variant",
                    },
                    "application_revision": {
                        "id": str(deleted_refs["application_revision"].id),
                        "slug": "delete-revision",
                        "version": "v1",
                    },
                }
            }
        },
    }
    assert "keep.revision" not in attributes["diff"]["updated"]
    assert "keep.revision" not in attributes["diff"]["created"]
    assert "keep.revision" not in attributes["diff"]["deleted"]
