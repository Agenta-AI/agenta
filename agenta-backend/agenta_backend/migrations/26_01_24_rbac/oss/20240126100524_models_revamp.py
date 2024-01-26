from beanie import iterative_migration, free_fall_migration
from .old_db_models import (
    OldAppEnvironmentDB,
    OldAppDB,
    OldDeploymentDB,
    OldEvaluationDB,
    OldAppVariantDB,
    OldEvaluationScenarioDB,
    OldEvaluatorConfigDB,
    OldHumanEvaluationDB,
    OldHumanEvaluationScenarioDB,
    OldImageDB,
    OldTestSetDB,
    OldUserDB,
    OldVariantBaseDB,
)
from .new_db_models import (
    NewAppEnvironmentDB,
    NewAppDB,
    NewDeploymentDB,
    NewEvaluationDB,
    NewAppVariantDB,
    NewEvaluationScenarioDB,
    NewEvaluatorConfigDB,
    NewHumanEvaluationDB,
    NewHumanEvaluationScenarioDB,
    NewImageDB,
    NewOrganizationDB,
    NewTestSetDB,
    NewUserDB,
    NewVariantBaseDB,
)



class Forward:
    
    @iterative_migration(
        document_models=[
            OldUserDB,
            NewUserDB,
        ]
    )
    async def remove_organization_from_user_model(
        self, input_document: OldUserDB, output_document: NewUserDB
    ):
        data = input_document.dict(exclude={"organizations"})
        new_document = NewUserDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldAppDB,
            NewAppDB,
        ]
    )
    async def remove_organization_from_app_model(
        self, input_document: OldAppDB, output_document: NewAppDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewAppDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldImageDB,
            NewImageDB,
        ]
    )
    async def remove_organization_from_image_model(
        self, input_document: OldImageDB, output_document: NewImageDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewImageDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldTestSetDB,
            NewTestSetDB,
        ]
    )
    async def remove_organization_from_testset_model(
        self, input_document: OldTestSetDB, output_document: NewTestSetDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewTestSetDB(**data)
    

    @iterative_migration(
        document_models=[
            OldVariantBaseDB,
            NewVariantBaseDB,
        ]
    )
    async def remove_organization_from_variant_base_model(
        self, input_document: OldVariantBaseDB, output_document: NewVariantBaseDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewVariantBaseDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldAppVariantDB,
            NewVariantBaseDB,
        ]
    )
    async def remove_organization_from_app_variant_model(
        self, input_document: OldAppVariantDB, output_document: NewAppVariantDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewAppVariantDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldEvaluationDB,
            NewEvaluationDB,
        ]
    )
    async def remove_organization_from_evaluation_model(
        self, input_document: OldEvaluationDB, output_document: NewEvaluationDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewEvaluationDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldDeploymentDB,
            NewDeploymentDB,
        ]
    )
    async def remove_organization_from_deployment_model(
        self, input_document: OldDeploymentDB, output_document: NewOrganizationDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewDeploymentDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldAppEnvironmentDB,
            NewAppEnvironmentDB,
        ]
    )
    async def remove_organization_from_app_environment_model(
        self, input_document: OldAppEnvironmentDB, output_document: NewAppEnvironmentDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewAppEnvironmentDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldEvaluatorConfigDB,
            NewEvaluatorConfigDB,
        ]
    )
    async def remove_organization_from_evaluator_config_model(
        self, input_document: OldEvaluatorConfigDB, output_document: NewEvaluatorConfigDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewEvaluatorConfigDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldHumanEvaluationDB,
            NewHumanEvaluationDB,
        ]
    )
    async def remove_organization_from_human_evaluation_model(
        self, input_document: OldHumanEvaluationDB, output_document: NewHumanEvaluationDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewHumanEvaluationDB(**data)
    
    
    @iterative_migration(
        document_models=[
            OldEvaluationScenarioDB,
            NewEvaluationScenarioDB,
        ]
    )
    async def remove_organization_from_evaluation_scenario_model(
        self, input_document: OldEvaluationScenarioDB, output_document: NewEvaluationScenarioDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewEvaluationScenarioDB(**data)
    
    @iterative_migration(
        document_models=[
            OldHumanEvaluationScenarioDB,
            NewHumanEvaluationScenarioDB,
        ]
    )
    async def remove_organization_from_app_environment_model(
        self, input_document: OldHumanEvaluationScenarioDB, output_document: NewHumanEvaluationScenarioDB
    ):
        data = input_document.dict(exclude={"organization"})
        new_document = NewHumanEvaluationScenarioDB(**data)
    


class Backward:
    pass
