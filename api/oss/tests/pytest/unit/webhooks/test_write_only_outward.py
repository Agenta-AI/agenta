"""Webhook signing secrets explicitly remain readable."""

from uuid import uuid4

import pytest

from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.services import VaultService
from oss.src.core.webhooks.service import WebhooksService
from oss.src.core.webhooks.types import (
    WebhookSubscription,
    WebhookSubscriptionCreate,
    WebhookSubscriptionData,
    WebhookSubscriptionEdit,
)


PROJECT_ID = uuid4()
USER_ID = uuid4()


class _FakeSecretsDAO:
    def __init__(self):
        self.records: dict = {}

    async def create(self, project_id, organization_id, create_secret_dto):
        record = SecretResponseDTO(
            id=uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
            write_only=bool(create_secret_dto.write_only),
        )
        self.records[record.id] = record
        return record

    async def get_by_id(self, secret_id, project_id, organization_id):
        return self.records.get(secret_id)

    async def list(self, project_id, organization_id):
        return list(self.records.values())

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        stored = self.records.get(secret_id)
        if stored is None:
            return None

        # Production resolves the update against the row under the write lock; the fake
        # does the same at the same point, so keep-on-omit is exercised, not skipped.
        if resolve_update is not None:
            update_secret_dto = resolve_update(stored, update_secret_dto)
        updated = stored.model_copy()
        if update_secret_dto.secret is not None:
            updated.data = update_secret_dto.secret.data
        self.records[secret_id] = updated
        return updated


class _FakeWebhooksDAO:
    def __init__(self):
        self.subscriptions: dict = {}

    async def create_subscription(
        self, *, project_id, user_id, subscription, secret_id
    ):
        record = WebhookSubscription(
            id=uuid4(),
            name=subscription.name,
            data=subscription.data,
            secret_id=secret_id,
        )
        self.subscriptions[record.id] = record
        return record

    async def fetch_subscription(self, *, project_id, subscription_id):
        return self.subscriptions.get(subscription_id)

    async def edit_subscription(self, *, project_id, user_id, subscription, secret_id):
        record = self.subscriptions.get(subscription.id)
        if record is None:
            return None
        record = record.model_copy(
            update={
                "name": subscription.name or record.name,
                "data": subscription.data,
                "secret_id": secret_id or record.secret_id,
            }
        )
        self.subscriptions[record.id] = record
        return record


@pytest.fixture(name="services")
def _services():
    secrets_dao = _FakeSecretsDAO()
    vault_service = VaultService(secrets_dao)
    webhooks_service = WebhooksService(
        webhooks_dao=_FakeWebhooksDAO(),
        vault_service=vault_service,
    )
    return webhooks_service, vault_service


def _subscription_create():
    return WebhookSubscriptionCreate(
        name="notify",
        data=WebhookSubscriptionData(url="https://example.com/hook"),
        secret="whsec_provided_by_user_12345",
    )


@pytest.mark.asyncio
async def test_webhook_signing_secret_is_explicitly_readable(services):
    webhooks_service, vault_service = services

    created = await webhooks_service.create_subscription(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        subscription=_subscription_create(),
    )
    assert created.secret == "whsec_provided_by_user_12345"

    stored = await webhooks_service.dao.fetch_subscription(
        project_id=PROJECT_ID,
        subscription_id=created.id,
    )
    secret_dto = await vault_service.get_secret_by_id(
        project_id=PROJECT_ID,
        secret_id=stored.secret_id,
    )
    assert secret_dto.write_only is False

    fetched = await webhooks_service.fetch_subscription(
        project_id=PROJECT_ID,
        subscription_id=created.id,
    )
    assert fetched.secret == "whsec_provided_by_user_12345"


@pytest.mark.asyncio
async def test_generated_secret_is_returned_on_the_create_echo(services):
    # The create echo is the ONLY place a caller can read a secret Agenta generated for
    # them. Redacting it would ship a subscription that can never be verified.
    webhooks_service, _ = services

    created = await webhooks_service.create_subscription(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        subscription=WebhookSubscriptionCreate(
            name="notify",
            data=WebhookSubscriptionData(url="https://example.com/hook"),
        ),
    )

    assert created.secret

    stored = await webhooks_service.dao.fetch_subscription(
        project_id=PROJECT_ID, subscription_id=created.id
    )
    signing_value = await webhooks_service._resolve_secret(
        project_id=PROJECT_ID,
        secret_id=stored.secret_id,
    )

    # What the subscriber was handed is what we sign with.
    assert created.secret == signing_value


@pytest.mark.asyncio
async def test_rotating_the_signing_secret_through_edit_replaces_the_stored_value(
    services,
):
    # The rotation path builds an update-path payload DTO; the parent `SecretDTO` does not
    # validate there, so this pins that editing a subscription's secret still works.
    webhooks_service, _ = services

    created = await webhooks_service.create_subscription(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        subscription=_subscription_create(),
    )

    edited = await webhooks_service.edit_subscription(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        subscription=WebhookSubscriptionEdit(
            id=created.id,
            name="notify",
            data=WebhookSubscriptionData(url="https://example.com/hook"),
            secret="whsec_test_rotated",
        ),
    )

    assert edited is not None

    stored = await webhooks_service.dao.fetch_subscription(
        project_id=PROJECT_ID, subscription_id=created.id
    )
    signing_value = await webhooks_service._resolve_secret(
        project_id=PROJECT_ID,
        secret_id=stored.secret_id,
    )

    assert signing_value == "whsec_test_rotated"
    assert edited.secret == "whsec_test_rotated"
