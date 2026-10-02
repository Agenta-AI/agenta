from typing import AsyncContextManager, Optional

from ee.src.core.subscriptions.types import SubscriptionDTO


class SubscriptionsDAOInterface:
    def __init__(self):
        raise NotImplementedError

    def lock(
        self,
        *,
        organization_id: str,
    ) -> AsyncContextManager[None]:
        """
        Serialize subscription changes for one organization: hold the returned context
        while reading, changing, and acting on the subscription. A second holder for the
        same organization waits until the first exits.
        """
        raise NotImplementedError

    async def create(
        self,
        *,
        subscription: SubscriptionDTO,
    ) -> SubscriptionDTO:
        """
        Create a new subscription.

        Parameters:
        - subscription: SubscriptionDTO containing subscription details.

        Returns:
        - SubscriptionDTO: The created subscription.
        """
        raise NotImplementedError

    async def read(
        self,
        *,
        organization_id: str,
    ) -> Optional[SubscriptionDTO]:
        """
        Read a subscription by organization ID.

        Parameters:
        - organization_id: The ID of the organization to fetch.

        Returns:
        - Optional[SubscriptionDTO]: The subscription if found, else None.
        """
        raise NotImplementedError

    async def update(
        self,
        *,
        subscription: SubscriptionDTO,
    ) -> Optional[SubscriptionDTO]:
        """
        Update an existing subscription.

        Parameters:
        - subscription: SubscriptionDTO containing updated details.

        Returns:
        - Optional[SubscriptionDTO]: The updated subscription if found, else None.
        """
        raise NotImplementedError
