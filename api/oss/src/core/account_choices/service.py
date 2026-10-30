"""Account choices, and the one resolution of a person's accounts for an agent's
"user" items, which the run, Needs setup and the editor all use."""

from typing import List, Optional, Sequence
from uuid import UUID

from agenta.sdk.agents.accounts import UserItem, user_item_from_key

from oss.src.core.account_choices.dtos import (
    AccountChoice,
    AccountChoiceQuery,
    AccountChoiceUpsert,
    ItemAccount,
)
from oss.src.core.account_choices.exceptions import (
    AccountNotForItem,
    AccountNotYours,
    ChoiceNotSupported,
)
from oss.src.core.account_choices.interfaces import AccountChoicesDAOInterface
from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.shared.dtos import Windowing
from oss.src.utils.env import env

# A choice is stored only for these kinds. An MCP server uses the person's sign-in, and
# no flow creates a person's subscription login yet.
_CHOICE_KINDS = ("app_connection", "secret")


class AccountChoicesService:
    def __init__(self, *, account_choices_dao: AccountChoicesDAOInterface):
        self.account_choices_dao = account_choices_dao

    async def resolve(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        artifact_id: Optional[UUID],
        user_id: Optional[UUID],
        items: Sequence[UserItem],
    ) -> List[ItemAccount]:
        """One `ItemAccount` per item, in the order given. No read when there are no
        items or no person (every item then has no match and no candidates); exactly one
        SQL statement otherwise. Never raises for a missing account, and makes no
        upstream call."""
        if not items:
            return []
        if user_id is None:
            return [ItemAccount(item_key=item.item_key) for item in items]
        # The statement decrypts an MCP grant's expiry to tell whether it is ready.
        with set_data_encryption_key(data_encryption_key=env.agenta.crypt_key):
            return await self.account_choices_dao.resolve(
                organization_id=organization_id,
                project_id=project_id,
                artifact_id=artifact_id,
                user_id=user_id,
                items=items,
            )

    async def upsert(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        choice: AccountChoiceUpsert,
    ) -> AccountChoice:
        """Store the choice, or replace the account of the person's choice for the same
        agent and item. The caller has checked that the person may run the agent."""
        item = user_item_from_key(choice.item_key)
        if item is None or item.kind not in _CHOICE_KINDS:
            raise ChoiceNotSupported()
        account = await self.account_choices_dao.fetch_chosen_account(
            organization_id=organization_id,
            user_id=user_id,
            secret_id=choice.secret_id,
            gateway_connection_id=choice.gateway_connection_id,
        )
        if account is None:
            raise AccountNotYours()
        fits = (
            account.secret_kind == SecretKind.CUSTOM_SECRET
            if item.kind == "secret"
            else account.provider_key == "composio"
            and account.integration_key == item.match_text
        )
        if not fits:
            raise AccountNotForItem()
        return await self.account_choices_dao.upsert(
            project_id=project_id, user_id=user_id, choice=choice
        )

    async def fetch(
        self, *, project_id: UUID, user_id: UUID, account_choice_id: UUID
    ) -> Optional[AccountChoice]:
        return await self.account_choices_dao.fetch(
            project_id=project_id,
            user_id=user_id,
            account_choice_id=account_choice_id,
        )

    async def query(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        query: AccountChoiceQuery,
        windowing: Optional[Windowing] = None,
    ) -> List[AccountChoice]:
        return await self.account_choices_dao.query(
            project_id=project_id, user_id=user_id, query=query, windowing=windowing
        )

    async def delete(
        self, *, project_id: UUID, user_id: UUID, account_choice_id: UUID
    ) -> bool:
        return await self.account_choices_dao.delete(
            project_id=project_id,
            user_id=user_id,
            account_choice_id=account_choice_id,
        )


# -- registry ------------------------------------------------------------------------

_account_choices_service: Optional[AccountChoicesService] = None


def register_account_choices_service(
    *, account_choices_service: AccountChoicesService
) -> None:
    global _account_choices_service
    _account_choices_service = account_choices_service


def get_account_choices_service() -> AccountChoicesService:
    if _account_choices_service is None:
        raise RuntimeError(
            "AccountChoicesService is not registered. "
            "Call entrypoints.access.bootstrap_access() at process startup."
        )
    return _account_choices_service
