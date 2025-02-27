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
        UserDB_ as UserDB,
        ImageDB_ as ImageDB,
        TestSetDB_ as TestSetDB,
        AppVariantDB_ as AppVariantDB,
        EvaluationDB_ as EvaluationDB,
        DeploymentDB_ as DeploymentDB,
        VariantBaseDB_ as VariantBaseDB,
        AppEnvironmentDB_ as AppEnvironmentDB,
        AppEnvironmentRevisionDB_ as AppEnvironmentRevisionDB,
        EvaluatorConfigDB_ as EvaluatorConfigDB,
        HumanEvaluationDB_ as HumanEvaluationDB,
        EvaluationScenarioDB_ as EvaluationScenarioDB,
        HumanEvaluationScenarioDB_ as HumanEvaluationScenarioDB,
    )
else:
    from oss.src.models.db_models import (
        AppDB,
        UserDB,
        ProjectDB,
        ImageDB,
        TestSetDB,
        EvaluationDB,
        DeploymentDB,
        AppVariantDB,
        VariantBaseDB,
        AppEnvironmentDB,
        AppEnvironmentRevisionDB,
        EvaluatorConfigDB,
        HumanEvaluationDB,
        EvaluationScenarioDB,
        HumanEvaluationScenarioDB,
    )

from oss.src.models.db_models import (
    TemplateDB,
    AppVariantRevisionsDB,
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
