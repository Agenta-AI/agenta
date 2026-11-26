from oss.src.core.account_choices.dtos import AccountChoice
from oss.src.dbs.postgres.account_choices.dbes import AccountChoiceDBE


def map_account_choice_dbe_to_dto(dbe: AccountChoiceDBE) -> AccountChoice:
    return AccountChoice(
        id=dbe.id,
        workflow_id=dbe.artifact_id,
        item_key=dbe.item_key,
        secret_id=dbe.secret_id,
        gateway_connection_id=dbe.gateway_connection_id,
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
    )
