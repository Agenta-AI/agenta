from oss.src.utils.common import is_ee

if is_ee():
    from ee.src.models.db_models import (
        APIKeyDB,
        ProjectDB,
        WorkspaceDB,
        OrganizationDB,
        InvitationDB,
        OrganizationMemberDB,
        WorkspaceMemberDB,
        ProjectMemberDB,
        AppDB_ as AppDB,
        EvaluationDB_ as EvaluationDB,
        DeploymentDB_ as DeploymentDB,
        HumanEvaluationDB_ as HumanEvaluationDB,
        EvaluationScenarioDB_ as EvaluationScenarioDB,
        HumanEvaluationScenarioDB_ as HumanEvaluationScenarioDB,
    )
else:
    from oss.src.models.db_models import (
        AppDB,
        ProjectDB,
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

models = [
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
    models.extend([OrganizationDB, WorkspaceDB, APIKeyDB, InvitationDB, OrganizationMemberDB, ProjectMemberDB, WorkspaceMemberDB])  # type: ignore
