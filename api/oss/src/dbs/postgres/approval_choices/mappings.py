from oss.src.core.approval_choices.dtos import ApprovalChoice
from oss.src.dbs.postgres.approval_choices.dbes import ApprovalChoiceDBE


def map_approval_choice_dbe_to_dto(dbe: ApprovalChoiceDBE) -> ApprovalChoice:
    return ApprovalChoice(
        id=dbe.id,
        call_ref=dbe.call_ref,
        created_at=dbe.created_at,
    )
