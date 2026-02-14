from oss.src.utils.common import is_ee

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
        EvaluationScenarioDB,
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
        EvaluationScenarioDB,
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
    EvaluationScenarioDB,
    AppVariantRevisionsDB,
    OrganizationDB,
    WorkspaceDB,
    APIKeyDB,
    InvitationDB,
]

if is_ee():
    models.extend(
        [
            OrganizationMemberDB,
            ProjectMemberDB,
            WorkspaceMemberDB,
        ]
    )  # type: ignore
