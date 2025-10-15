import uuid
from typing import List, Dict, Any
from datetime import datetime, timezone

from oss.src.services import db_manager
from oss.src.models.api.evaluation_model import (
    CorrectAnswer,
    Evaluation,
    HumanEvaluation,
    EvaluationScenario,
    SimpleEvaluationOutput,
    EvaluationScenarioInput,
    HumanEvaluationScenario,
    EvaluationScenarioOutput,
)
from ee.src.services import db_manager_ee
from ee.src.models.api.workspace_models import (
    WorkspaceRole,
    WorkspaceResponse,
)
from ee.src.models.shared_models import Permission
from ee.src.models.db_models import (
    EvaluationDB,
    HumanEvaluationDB,
    EvaluationScenarioDB,
    HumanEvaluationScenarioDB,
)
from oss.src.models.db_models import WorkspaceDB


async def get_workspace_in_format(
    workspace: WorkspaceDB,
) -> WorkspaceResponse:
    """Converts the workspace object to the WorkspaceResponse model.

    Arguments:
        workspace (WorkspaceDB): The workspace object
        project_id (str): The project ID

    Returns:
        WorkspaceResponse: The workspace object in the WorkspaceResponse model
    """

    members = []

    project = await db_manager_ee.get_project_by_workspace(
        workspace_id=str(workspace.id)
    )
    project_members = await db_manager_ee.get_project_members(
        project_id=str(project.id)
    )
    invitations = await db_manager_ee.get_project_invitations(
        project_id=str(project.id), invitation_used=False
    )

    if len(invitations) > 0:
        for invitation in invitations:
            if not invitation.used and str(invitation.project_id) == str(project.id):
                user = await db_manager.get_user_with_email(invitation.email)
                member_dict = {
                    "user": {
                        "id": str(user.id) if user else invitation.email,
                        "email": user.email if user else invitation.email,
                        "username": (
                            user.username if user else invitation.email.split("@")[0]
                        ),
                        "status": (
                            "pending"
                            if invitation.expiration_date > datetime.now(timezone.utc)
                            else "expired"
                        ),
                        "created_at": (
                            str(user.created_at)
                            if user
                            else (
                                str(invitation.created_at)
                                if str(invitation.created_at)
                                else None
                            )
                        ),
                    },
                    "roles": [
                        {
                            "role_name": invitation.role,
                            "role_description": WorkspaceRole.get_description(
                                invitation.role
                            ),
                        }
                    ],
                }
                members.append(member_dict)

    for project_member in project_members:
        member_role = project_member.role
        member_dict = {
            "user": {
                "id": str(project_member.user.id),
                "email": project_member.user.email,
                "username": project_member.user.username,
                "status": "member",
                "created_at": str(project_member.user.created_at),
            },
            "roles": (
                [
                    {
                        "role_name": member_role,
                        "role_description": WorkspaceRole.get_description(member_role),
                        "permissions": Permission.default_permissions(member_role),
                    }
                ]
                if member_role
                else []
            ),
        }
        members.append(member_dict)

    workspace_response = WorkspaceResponse(
        id=str(workspace.id),
        name=workspace.name,
        description=workspace.description,
        type=workspace.type,
        members=members,
        organization=str(workspace.organization_id),
        created_at=str(workspace.created_at),
        updated_at=str(workspace.updated_at),
    )
    return workspace_response


async def get_all_workspace_permissions() -> List[Permission]:
    """
    Retrieve all workspace permissions.

    Returns:
        List[Permission]: A list of all workspace permissions in the DB.
    """
    workspace_permissions = list(Permission)
    return workspace_permissions


def get_all_workspace_permissions_by_role(role_name: str) -> Dict[str, List[Any]]:
    """
    Retrieve all workspace permissions.

    Returns:
        List[Permission]: A list of all workspace permissions in the DB.
    """
    workspace_permissions = Permission.default_permissions(
        getattr(WorkspaceRole, role_name.upper())
    )
    return workspace_permissions


async def human_evaluation_db_to_simple_evaluation_output(
    human_evaluation_db: HumanEvaluationDB,
) -> SimpleEvaluationOutput:
    evaluation_variants = await db_manager_ee.fetch_human_evaluation_variants(
        human_evaluation_id=str(human_evaluation_db.id)
    )
    return SimpleEvaluationOutput(
        id=str(human_evaluation_db.id),
        app_id=str(human_evaluation_db.app_id),
        project_id=str(human_evaluation_db.project_id),
        status=human_evaluation_db.status,  # type: ignore
        evaluation_type=human_evaluation_db.evaluation_type,  # type: ignore
        variant_ids=[
            str(evaluation_variant.variant_id)
            for evaluation_variant in evaluation_variants
        ],
    )


async def evaluation_db_to_pydantic(
    evaluation_db: EvaluationDB,
) -> Evaluation:
    variant_name = (
        evaluation_db.variant.variant_name
        if evaluation_db.variant.variant_name
        else str(evaluation_db.variant_id)
    )
    aggregated_results = aggregated_result_of_evaluation_to_pydantic(
        evaluation_db.aggregated_results
    )

    return Evaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app_id),
        project_id=str(evaluation_db.project_id),
        status=evaluation_db.status,
        variant_ids=[str(evaluation_db.variant_id)],
        variant_revision_ids=[str(evaluation_db.variant_revision_id)],
        revisions=[str(evaluation_db.variant_revision.revision)],
        variant_names=[variant_name],
        testset_id=str(evaluation_db.testset_id),
        testset_name=evaluation_db.testset.name,
        aggregated_results=aggregated_results,
        created_at=str(evaluation_db.created_at),
        updated_at=str(evaluation_db.updated_at),
        average_cost=evaluation_db.average_cost,
        total_cost=evaluation_db.total_cost,
        average_latency=evaluation_db.average_latency,
    )


async def human_evaluation_db_to_pydantic(
    evaluation_db: HumanEvaluationDB,
) -> HumanEvaluation:
    evaluation_variants = await db_manager_ee.fetch_human_evaluation_variants(
        human_evaluation_id=str(evaluation_db.id)  # type: ignore
    )

    revisions = []
    variants_ids = []
    variants_names = []
    variants_revision_ids = []
    for evaluation_variant in evaluation_variants:
        variant_name = (
            evaluation_variant.variant.variant_name
            if isinstance(evaluation_variant.variant_id, uuid.UUID)
            else str(evaluation_variant.variant_id)
        )
        variants_names.append(str(variant_name))
        variants_ids.append(str(evaluation_variant.variant_id))
        variant_revision = (
            str(evaluation_variant.variant_revision.revision)
            if isinstance(evaluation_variant.variant_revision_id, uuid.UUID)
            else " None"
        )
        revisions.append(variant_revision)
        variants_revision_ids.append(str(evaluation_variant.variant_revision_id))

    return HumanEvaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app_id),
        project_id=str(evaluation_db.project_id),
        status=evaluation_db.status,  # type: ignore
        evaluation_type=evaluation_db.evaluation_type,  # type: ignore
        variant_ids=variants_ids,
        variant_names=variants_names,
        testset_id=str(evaluation_db.testset_id),
        testset_name=evaluation_db.testset.name,
        variants_revision_ids=variants_revision_ids,
        revisions=revisions,
        created_at=str(evaluation_db.created_at),  # type: ignore
        updated_at=str(evaluation_db.updated_at),  # type: ignore
    )


def human_evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: HumanEvaluationScenarioDB, evaluation_id: str
) -> HumanEvaluationScenario:
    return HumanEvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=evaluation_id,
        inputs=evaluation_scenario_db.inputs,  # type: ignore
        outputs=evaluation_scenario_db.outputs,  # type: ignore
        vote=evaluation_scenario_db.vote,  # type: ignore
        score=evaluation_scenario_db.score,  # type: ignore
        correct_answer=evaluation_scenario_db.correct_answer,  # type: ignore
        is_pinned=evaluation_scenario_db.is_pinned or False,  # type: ignore
        note=evaluation_scenario_db.note or "",  # type: ignore
    )


def aggregated_result_of_evaluation_to_pydantic(
    evaluation_aggregated_results: List,
) -> List[dict]:
    transformed_results = []
    for aggregated_result in evaluation_aggregated_results:
        evaluator_config_dict = (
            {
                "id": str(aggregated_result.evaluator_config.id),
                "name": aggregated_result.evaluator_config.name,
                "evaluator_key": aggregated_result.evaluator_config.evaluator_key,
                "settings_values": aggregated_result.evaluator_config.settings_values,
                "created_at": str(aggregated_result.evaluator_config.created_at),
                "updated_at": str(aggregated_result.evaluator_config.updated_at),
            }
            if isinstance(aggregated_result.evaluator_config_id, uuid.UUID)
            else None
        )
        transformed_results.append(
            {
                "evaluator_config": (
                    {} if evaluator_config_dict is None else evaluator_config_dict
                ),
                "result": aggregated_result.result,
            }
        )
    return transformed_results


async def evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: EvaluationScenarioDB, evaluation_id: str
) -> EvaluationScenario:
    scenario_results = [
        {
            "evaluator_config": str(scenario_result.evaluator_config_id),
            "result": scenario_result.result,
        }
        for scenario_result in evaluation_scenario_db.results
    ]
    return EvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=evaluation_id,
        inputs=[
            EvaluationScenarioInput(**scenario_input)  # type: ignore
            for scenario_input in evaluation_scenario_db.inputs
        ],
        outputs=[
            EvaluationScenarioOutput(**scenario_output)  # type: ignore
            for scenario_output in evaluation_scenario_db.outputs
        ],
        correct_answers=[
            CorrectAnswer(**correct_answer)  # type: ignore
            for correct_answer in evaluation_scenario_db.correct_answers
        ],
        is_pinned=evaluation_scenario_db.is_pinned or False,  # type: ignore
        note=evaluation_scenario_db.note or "",  # type: ignore
        results=scenario_results,  # type: ignore
    )
