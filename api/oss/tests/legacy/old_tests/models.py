from typing import List

from oss.src.utils.common import is_ee

from oss.src.dbs.postgres.shared.base import Base

if is_ee():
    from oss.src.models.db_models import (
        APIKeyDB,
        ProjectDB,
        WorkspaceDB,
        OrganizationDB,
        InvitationDB,
        AppDB,
        EvaluationDB,
        DeploymentDB,
        HumanEvaluationDB,
        EvaluationScenarioDB,
        HumanEvaluationScenarioDB,
    )
    from ee.src.models.db_models import (
        OrganizationMemberDB,
        WorkspaceMemberDB,
        ProjectMemberDB,
    )
else:
    from oss.src.models.db_models import (
        APIKeyDB,
        ProjectDB,
        WorkspaceDB,
        OrganizationDB,
        InvitationDB,
        AppDB,
        EvaluationDB,
        DeploymentDB,
        HumanEvaluationDB,
        EvaluationScenarioDB,
        HumanEvaluationScenarioDB,
    )

from oss.src.models.db_models import (
    UserDB,
    TestsetDB,
    AppVariantDB,
    VariantBaseDB,
    AppEnvironmentDB,
    EvaluatorConfigDB,
    AppVariantRevisionsDB,
    AppEnvironmentRevisionDB,
)

models: List[Base] = [
    AppDB,
    UserDB,
    ProjectDB,
    TestsetDB,
    AppVariantDB,
    DeploymentDB,
    EvaluationDB,
    VariantBaseDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    EvaluationScenarioDB,
    AppVariantRevisionsDB,
    HumanEvaluationScenarioDB,
]

if is_ee():
    models.extend(
        [
            OrganizationDB,
            WorkspaceDB,
            APIKeyDB,
            InvitationDB,
            OrganizationMemberDB,
            ProjectMemberDB,
            WorkspaceMemberDB,
        ]
    )  # type: ignore
