from ee.src.core.subscriptions.types import SubscriptionDTO
from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE

from ee.src.core.subscriptions.types import Plan


def map_dbe_to_dto(subscription_dbe: SubscriptionDBE) -> SubscriptionDTO:
    return SubscriptionDTO(
        organization_id=subscription_dbe.organization_id,
        customer_id=subscription_dbe.customer_id,
        subscription_id=subscription_dbe.subscription_id,
        plan=Plan(subscription_dbe.plan),
        active=subscription_dbe.active,
        anchor=subscription_dbe.anchor,
    )


def map_dto_to_dbe(subscription_dto: SubscriptionDTO) -> SubscriptionDBE:
    return SubscriptionDBE(
        organization_id=subscription_dto.organization_id,
        customer_id=subscription_dto.customer_id,
        subscription_id=subscription_dto.subscription_id,
        plan=subscription_dto.plan.value,
        active=subscription_dto.active or False,
        anchor=subscription_dto.anchor,
    )
