from typing import List

from oss.src.utils.common import isCloudEE

from oss.src.dbs.postgres.shared.base import Base

if isCloudEE():
    from ee.src.models.db_models import (
        APIKeyDB,
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
    ImageDB,
    TestSetDB,
    TemplateDB,
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
    ImageDB,
    TestSetDB,
    TemplateDB,
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

if isCloudEE():
    models.extend([OrganizationDB, WorkspaceDB, APIKeyDB, InvitationDB, OrganizationMemberDB, ProjectMemberDB, WorkspaceMemberDB])  # type: ignore
