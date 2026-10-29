from typing import List, Optional, Sequence
from uuid import UUID

from agenta.sdk.agents.accounts import UserItem

from oss.src.core.account_choices.dtos import (
    AccountChoice,
    AccountChoiceQuery,
    AccountChoiceUpsert,
    ChoiceAccount,
    ItemAccount,
)
from oss.src.core.shared.dtos import Windowing


class AccountChoicesDAOInterface:
    """Storage of `account_choices`. Every read and write names the project and the
    person, so a person only ever reaches their own choices."""

    async def upsert(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        choice: AccountChoiceUpsert,
    ) -> AccountChoice:
        raise NotImplementedError

    async def fetch(
        self, *, project_id: UUID, user_id: UUID, account_choice_id: UUID
    ) -> Optional[AccountChoice]:
        raise NotImplementedError

    async def query(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        query: AccountChoiceQuery,
        windowing: Optional[Windowing] = None,
    ) -> List[AccountChoice]:
        raise NotImplementedError

    async def delete(
        self, *, project_id: UUID, user_id: UUID, account_choice_id: UUID
    ) -> bool:
        raise NotImplementedError

    async def fetch_choice_account(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
        secret_id: Optional[UUID],
        gateway_connection_id: Optional[UUID],
    ) -> Optional[ChoiceAccount]:
        """The account an upsert names, only when the person owns it in the
        organization."""
        raise NotImplementedError

    async def resolve(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        artifact_id: UUID,
        user_id: UUID,
        items: Sequence[UserItem],
    ) -> List[ItemAccount]:
        """One `ItemAccount` per item, in the order given, in ONE SQL statement."""
        raise NotImplementedError
