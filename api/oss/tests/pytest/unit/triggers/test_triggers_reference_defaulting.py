"""Unit tests for the workflow_variant -> HEAD revision defaulting in
``TriggersService._validate_references``.

Agent-created schedules/subscriptions context-bind only a ``workflow_variant``
reference (see sdks/python/agenta/sdk/agents/platform/op_catalog.py), never a
``workflow_revision``. Without a bound revision the FE renders the trigger as
"which version runs? unset". This pins the variant's HEAD (latest) revision
into the stored references at create/edit time, so every caller gets a bound
trigger, while an artifact-only or environment-only reference (ambiguous by
design — "resolve latest at fire time") is left untouched. Stubs the
workflows service and DAO; no DB, no Composio.
"""

from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.core.shared.dtos import Reference
from oss.src.core.triggers.dtos import (
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
    TriggerSubscriptionFlags,
)
from oss.src.core.triggers.exceptions import TriggerReferenceInvalid
from oss.src.core.triggers.service import TriggersService


def _revision(*, revision_id=None, slug="rev-slug", version="3"):
    return SimpleNamespace(id=revision_id or uuid4(), slug=slug, version=version)


def _workflows_service(*, revision=None):
    service = MagicMock()
    service.retrieve_workflow_revision = AsyncMock(return_value=(revision, None, None))
    return service


def _service(*, workflows_service):
    return TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=MagicMock(),
        connections_service=MagicMock(),
        workflows_service=workflows_service,
    )


class TestValidateReferencesPinsHead:
    async def test_variant_only_is_pinned_to_head_revision(self):
        variant_id = uuid4()
        revision = _revision()
        workflows_service = _workflows_service(revision=revision)
        service = _service(workflows_service=workflows_service)

        references = {"workflow_variant": {"id": str(variant_id)}}

        await service._validate_references(
            project_id=uuid4(),
            references=references,
        )

        assert "workflow_revision" in references
        pinned = references["workflow_revision"]
        assert pinned.id == revision.id
        assert pinned.slug == revision.slug
        assert pinned.version == revision.version

        # The unpinned variant ref is what got resolved.
        kwargs = workflows_service.retrieve_workflow_revision.await_args.kwargs
        assert kwargs["workflow_variant_ref"].id == variant_id
        assert kwargs["workflow_revision_ref"] is None

    async def test_revision_already_present_is_left_untouched(self):
        revision_ref = Reference(id=uuid4(), slug="pinned-slug", version="1")
        revision = _revision()  # what "resolves" now — must NOT overwrite revision_ref
        workflows_service = _workflows_service(revision=revision)
        service = _service(workflows_service=workflows_service)

        references = {
            "workflow_variant": {"id": str(uuid4())},
            "workflow_revision": revision_ref,
        }

        await service._validate_references(
            project_id=uuid4(),
            references=references,
        )

        assert references["workflow_revision"] is revision_ref

    async def test_variant_with_no_revisions_raises_typed_error(self):
        workflows_service = _workflows_service(revision=None)
        service = _service(workflows_service=workflows_service)

        references = {"workflow_variant": {"id": str(uuid4())}}

        with pytest.raises(TriggerReferenceInvalid):
            await service._validate_references(
                project_id=uuid4(),
                references=references,
            )

        assert "workflow_revision" not in references

    async def test_artifact_only_reference_stays_unpinned(self):
        """No workflow_variant key at all -> latest-tracking is preserved."""
        revision = _revision()
        workflows_service = _workflows_service(revision=revision)
        service = _service(workflows_service=workflows_service)

        references = {"workflow": {"slug": "my-workflow"}}

        await service._validate_references(
            project_id=uuid4(),
            references=references,
        )

        assert references == {"workflow": {"slug": "my-workflow"}}

    async def test_environment_reference_stays_unpinned(self):
        revision = _revision()
        workflows_service = _workflows_service(revision=revision)
        service = _service(workflows_service=workflows_service)

        references = {
            "environment": {"slug": "production"},
            "application": {"slug": "my-app"},
        }

        await service._validate_references(
            project_id=uuid4(),
            references=references,
        )

        assert "application_revision" not in references
        assert references["environment"] == {"slug": "production"}

    async def test_application_prefix_variant_only_is_pinned(self):
        """The defaulting is prefix-agnostic (application / evaluator / workflow)."""
        revision = _revision()
        workflows_service = _workflows_service(revision=revision)
        service = _service(workflows_service=workflows_service)

        references = {"application_variant": {"id": str(uuid4())}}

        await service._validate_references(
            project_id=uuid4(),
            references=references,
        )

        assert references["application_revision"].id == revision.id


class TestCreateScheduleDefaultsVariantToHead:
    async def _service_with_dao(self, *, revision):
        workflows_service = _workflows_service(revision=revision)
        dao = MagicMock()

        async def _persist_create(*, project_id, user_id, schedule):
            return SimpleNamespace(
                id=uuid4(),
                created_by_id=user_id,
                data=schedule.data,
                flags=schedule.flags,
            )

        dao.create_schedule = AsyncMock(side_effect=_persist_create)
        service = TriggersService(
            adapter_registry=MagicMock(),
            catalog_service=MagicMock(),
            triggers_dao=dao,
            connections_service=MagicMock(),
            workflows_service=workflows_service,
        )
        return service, dao

    async def test_create_schedule_pins_head_revision_when_only_variant_given(self):
        revision = _revision()
        service, dao = await self._service_with_dao(revision=revision)

        variant_id = uuid4()
        schedule = TriggerScheduleCreate(
            name="sched",
            data=TriggerScheduleData(
                event_key="cron.tick",
                schedule="* * * * *",
                references={"workflow_variant": {"id": str(variant_id)}},
            ),
        )

        created = await service.create_schedule(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule=schedule,
        )

        persisted_refs = dao.create_schedule.await_args.kwargs[
            "schedule"
        ].data.references
        assert persisted_refs["workflow_revision"].id == revision.id
        assert created.data.references["workflow_revision"].id == revision.id

    async def test_create_schedule_leaves_explicit_revision_untouched(self):
        revision = _revision()
        service, dao = await self._service_with_dao(revision=revision)

        pinned_id = uuid4()
        schedule = TriggerScheduleCreate(
            name="sched",
            data=TriggerScheduleData(
                event_key="cron.tick",
                schedule="* * * * *",
                references={
                    "workflow_variant": {"id": str(uuid4())},
                    "workflow_revision": {"id": str(pinned_id)},
                },
            ),
        )

        await service.create_schedule(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule=schedule,
        )

        persisted_refs = dao.create_schedule.await_args.kwargs[
            "schedule"
        ].data.references
        assert persisted_refs["workflow_revision"].id == pinned_id

    async def test_create_schedule_raises_when_variant_has_no_revisions(self):
        service, dao = await self._service_with_dao(revision=None)

        schedule = TriggerScheduleCreate(
            name="sched",
            data=TriggerScheduleData(
                event_key="cron.tick",
                schedule="* * * * *",
                references={"workflow_variant": {"id": str(uuid4())}},
            ),
        )

        with pytest.raises(TriggerReferenceInvalid):
            await service.create_schedule(
                project_id=uuid4(),
                user_id=uuid4(),
                schedule=schedule,
            )

        dao.create_schedule.assert_not_awaited()


class TestCreateSubscriptionDefaultsVariantToHead:
    def _service(self, *, revision):
        adapter = MagicMock()
        adapter.create_subscription = AsyncMock(return_value="ti_1")
        registry = MagicMock()
        registry.get = MagicMock(return_value=adapter)

        connection = MagicMock()
        connection.provider_key.value = "composio"
        connection.provider_connection_id = "ca_1"

        connections = MagicMock()
        connections.get_connection = AsyncMock(return_value=connection)

        dao = MagicMock()

        async def _persist_create(*, project_id, user_id, subscription, trigger_id):
            return TriggerSubscription(
                id=uuid4(),
                created_by_id=user_id,
                connection_id=subscription.connection_id,
                trigger_id=trigger_id,
                data=subscription.data,
                flags=subscription.flags,
            )

        dao.create_subscription = AsyncMock(side_effect=_persist_create)

        workflows_service = _workflows_service(revision=revision)

        service = TriggersService(
            adapter_registry=registry,
            catalog_service=MagicMock(),
            triggers_dao=dao,
            connections_service=connections,
            workflows_service=workflows_service,
        )
        return service, dao

    async def test_create_subscription_pins_head_revision_when_only_variant_given(self):
        revision = _revision()
        service, dao = self._service(revision=revision)

        subscription = TriggerSubscriptionCreate(
            connection_id=uuid4(),
            data=TriggerSubscriptionData(
                event_key="github.issue.opened",
                references={"workflow_variant": {"id": str(uuid4())}},
            ),
            flags=TriggerSubscriptionFlags(is_test=False),
        )

        created = await service.create_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=subscription,
        )

        persisted_refs = dao.create_subscription.await_args.kwargs[
            "subscription"
        ].data.references
        assert persisted_refs["workflow_revision"].id == revision.id
        assert created.data.references["workflow_revision"].id == revision.id

    async def test_create_subscription_raises_when_variant_has_no_revisions(self):
        service, dao = self._service(revision=None)

        subscription = TriggerSubscriptionCreate(
            connection_id=uuid4(),
            data=TriggerSubscriptionData(
                event_key="github.issue.opened",
                references={"workflow_variant": {"id": str(uuid4())}},
            ),
            flags=TriggerSubscriptionFlags(is_test=False),
        )

        with pytest.raises(TriggerReferenceInvalid):
            await service.create_subscription(
                project_id=uuid4(),
                user_id=uuid4(),
                subscription=subscription,
            )

        dao.create_subscription.assert_not_awaited()
