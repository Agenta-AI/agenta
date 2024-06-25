import json
import os
import asyncio
from datetime import datetime, timezone

from pymongo import MongoClient
from bson import DBRef
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import UUID
import uuid_utils.compat as uuid

from agenta_backend.models.db_models import (
    UserDB,
    ImageDB,
    AppDB,
    DeploymentDB,
    VariantBaseDB,
    AppVariantDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    TemplateDB,
    TestSetDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationVariantDB,
    HumanEvaluationScenarioDB,
    EvaluationAggregatedResultDB,
    EvaluationScenarioResultDB,
    EvaluationDB,
    EvaluationEvaluatorConfigDB,
    EvaluationScenarioDB,
    IDsMappingDB,
    AppVariantRevisionsDB,
)

from agenta_backend.migrations.mongo_to_postgres.utils import (
    drop_all_tables,
    create_all_tables,
    print_migration_report,
    store_mapping,
    get_mapped_uuid,
    generate_uuid,
    get_datetime,
    migrate_collection,
)

from agenta_backend.models.shared_models import TemplateType

tables = [
    UserDB,
    ImageDB,
    AppDB,
    DeploymentDB,
    VariantBaseDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    TemplateDB,
    TestSetDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    EvaluationDB,
    EvaluationScenarioDB,
    IDsMappingDB,
    EvaluationEvaluatorConfigDB,
    EvaluationScenarioResultDB,
]


async def transform_user(user):
    user_uuid = generate_uuid()
    await store_mapping("users", user["_id"], user_uuid)
    return {
        "id": user_uuid,
        "uid": user["uid"],
        "username": user["username"],
        "email": user["email"],
        "created_at": get_datetime(user.get("created_at")),
        "updated_at": get_datetime(user.get("updated_at")),
    }


async def transform_image(image):
    user_uuid = await get_mapped_uuid(
        "users", image["user"].id if isinstance(image["user"], DBRef) else image["user"]
    )
    image_uuid = generate_uuid()
    await store_mapping("docker_images", image["_id"], image_uuid)
    return {
        "id": image_uuid,
        "type": image["type"],
        "template_uri": image.get("template_uri"),
        "docker_id": image.get("docker_id"),
        "tags": image.get("tags"),
        "deletable": image.get("deletable", True),
        "user_id": user_uuid,
        "created_at": get_datetime(image.get("created_at")),
        "updated_at": get_datetime(image.get("updated_at")),
    }


async def transform_app(app):
    user_uuid = await get_mapped_uuid("users", app["user"].id)
    app_uuid = generate_uuid()
    await store_mapping("app_db", app["_id"], app_uuid)
    return {
        "id": app_uuid,
        "app_name": app["app_name"],
        "user_id": user_uuid,
        "created_at": get_datetime(app.get("created_at")),
        "updated_at": get_datetime(app.get("updated_at")),
    }


async def transform_deployment(deployment):
    app_uuid = await get_mapped_uuid("app_db", deployment["app"].id)
    user_uuid = await get_mapped_uuid("users", deployment["user"].id)
    deployment_uuid = generate_uuid()
    await store_mapping("deployments", deployment["_id"], deployment_uuid)
    return {
        "id": deployment_uuid,
        "app_id": app_uuid,
        "user_id": user_uuid,
        "container_name": deployment.get("container_name"),
        "container_id": deployment.get("container_id"),
        "uri": deployment.get("uri"),
        "status": deployment["status"],
        "created_at": get_datetime(deployment.get("created_at")),
        "updated_at": get_datetime(deployment.get("updated_at")),
    }


async def transform_variant_base(base):
    app_uuid = await get_mapped_uuid("app_db", base["app"].id)
    user_uuid = await get_mapped_uuid("users", base["user"].id)
    image_uuid = await get_mapped_uuid("docker_images", base["image"].id)
    deployment_uuid = base["deployment"] and await get_mapped_uuid(
        "deployments", base["deployment"]
    )
    base_uuid = generate_uuid()
    await store_mapping("bases", base["_id"], base_uuid)
    return {
        "id": base_uuid,
        "app_id": app_uuid,
        "user_id": user_uuid,
        "base_name": base["base_name"],
        "image_id": image_uuid,
        "deployment_id": deployment_uuid,
        "created_at": get_datetime(base.get("created_at")),
        "updated_at": get_datetime(base.get("updated_at")),
    }


async def transform_app_variant(variant):
    app_uuid = await get_mapped_uuid("app_db", variant["app"].id)
    image_uuid = await get_mapped_uuid("docker_images", variant["image"].id)
    user_uuid = await get_mapped_uuid("users", variant["user"].id)
    modified_by_uuid = await get_mapped_uuid("users", variant["modified_by"].id)
    base_uuid = await get_mapped_uuid("bases", variant["base"].id)
    variant_uuid = generate_uuid()
    await store_mapping("app_variants", variant["_id"], variant_uuid)
    return {
        "id": variant_uuid,
        "app_id": app_uuid,
        "variant_name": variant["variant_name"],
        "revision": variant["revision"],
        "image_id": image_uuid,
        "user_id": user_uuid,
        "modified_by_id": modified_by_uuid,
        "base_name": variant.get("base_name"),
        "base_id": base_uuid,
        "config_name": variant["config_name"],
        "config_parameters": variant["config"],
        "created_at": get_datetime(variant.get("created_at")),
        "updated_at": get_datetime(variant.get("updated_at")),
    }


async def transform_app_variant_revision(revision):
    variant_uuid = await get_mapped_uuid("app_variants", revision["variant"].id)
    modified_by_uuid = await get_mapped_uuid("users", revision["modified_by"].id)
    base_uuid = await get_mapped_uuid("bases", revision["base"].id)
    revision_uuid = generate_uuid()
    await store_mapping("app_variant_revisions", revision["_id"], revision_uuid)
    return {
        "id": revision_uuid,
        "variant_id": variant_uuid,
        "revision": revision["revision"],
        "modified_by_id": modified_by_uuid,
        "base_id": base_uuid,
        "config_name": revision["config"]["config_name"],
        "config_parameters": revision["config"]["parameters"],
        "created_at": get_datetime(revision["created_at"]),
        "updated_at": get_datetime(revision["updated_at"]),
    }


async def transform_app_environment(environment):
    app_uuid = await get_mapped_uuid("app_db", environment["app"].id)
    user_uuid = await get_mapped_uuid("users", environment["user"].id)
    variant_uuid = await get_mapped_uuid(
        "app_variants", environment["deployed_app_variant"]
    )
    revision_uuid = await get_mapped_uuid(
        "app_variant_revisions", environment["deployed_app_variant_revision"]
    )
    deployment_uuid = await get_mapped_uuid("deployments", environment["deployment"])
    environment_uuid = generate_uuid()
    await store_mapping("environments", environment["_id"], environment_uuid)
    return {
        "id": environment_uuid,
        "app_id": app_uuid,
        "name": environment["name"],
        "user_id": user_uuid,
        "revision": environment["revision"],
        "deployed_app_variant_id": variant_uuid,
        "deployed_app_variant_revision_id": revision_uuid,
        "deployment_id": deployment_uuid,
        "created_at": get_datetime(environment.get("created_at")),
    }


async def transform_app_environment_revision(revision):
    environment_uuid = await get_mapped_uuid("environments", revision["environment"].id)
    modified_by_uuid = await get_mapped_uuid("users", revision["modified_by"].id)
    variant_revision_uuid = await get_mapped_uuid(
        "app_variant_revisions", revision["deployed_app_variant_revision"]
    )
    deployment_uuid = await get_mapped_uuid("deployments", revision["deployment"])
    revision_uuid = generate_uuid()
    await store_mapping("environments_revisions", revision["_id"], revision_uuid)
    return {
        "id": revision_uuid,
        "environment_id": environment_uuid,
        "revision": revision["revision"],
        "modified_by_id": modified_by_uuid,
        "deployed_app_variant_revision_id": variant_revision_uuid,
        "deployment_id": deployment_uuid,
        "created_at": get_datetime(revision["created_at"]),
    }


async def transform_template(template):
    template_uuid = generate_uuid()
    await store_mapping("templates", template["_id"], template_uuid)

    template_type = (
        TemplateType(template["type"]) if "type" in template else TemplateType.IMAGE
    )

    return {
        "id": template_uuid,
        "type": template_type,
        "template_uri": template.get("template_uri"),
        "tag_id": template.get("tag_id"),
        "name": template["name"],
        "repo_name": template.get("repo_name"),
        "title": template["title"],
        "description": template["description"],
        "size": template.get("size"),
        "digest": template.get("digest"),
        "last_pushed": get_datetime(template.get("last_pushed")),
    }


async def transform_test_set(test_set):
    app_uuid = await get_mapped_uuid("app_db", test_set["app"].id)
    user_uuid = await get_mapped_uuid("users", test_set["user"].id)
    test_set_uuid = generate_uuid()
    await store_mapping("testsets", test_set["_id"], test_set_uuid)
    return {
        "id": test_set_uuid,
        "name": test_set["name"],
        "app_id": app_uuid,
        "csvdata": test_set["csvdata"],
        "user_id": user_uuid,
        "created_at": get_datetime(test_set.get("created_at")),
        "updated_at": get_datetime(test_set.get("updated_at")),
    }


async def transform_evaluator_config(config):
    app_uuid = await get_mapped_uuid("app_db", config["app"].id)
    user_uuid = await get_mapped_uuid("users", config["user"].id)
    config_uuid = generate_uuid()
    await store_mapping("evaluators_configs", config["_id"], config_uuid)
    return {
        "id": config_uuid,
        "app_id": app_uuid,
        "user_id": user_uuid,
        "name": config["name"],
        "evaluator_key": config["evaluator_key"],
        "settings_values": config["settings_values"],
        "created_at": get_datetime(config.get("created_at")),
        "updated_at": get_datetime(config.get("updated_at")),
    }


async def convert_human_evaluations_associated_variants(
    variants, variants_revisions, evaluation_id
):
    """Convert variant and revision ObjectIds to UUIDs and structure them."""
    associated_variants = []
    assert len(variants) == len(
        variants_revisions
    ), "variants and variants_revisions must have the same length"

    for variant_id, revision_id in zip(variants, variants_revisions):
        variant_uuid = await get_mapped_uuid("app_variants", variant_id)
        revision_uuid = await get_mapped_uuid("app_variant_revisions", revision_id)
        associated_variants.append(
            {
                "human_evaluation_id": evaluation_id,
                "variant_id": variant_uuid,
                "variant_revision_id": revision_uuid,
            }
        )
    return associated_variants


async def transform_human_evaluation(evaluation):
    app_uuid = await get_mapped_uuid("app_db", evaluation["app"].id)
    user_uuid = await get_mapped_uuid("users", evaluation["user"].id)
    test_set_uuid = await get_mapped_uuid("testsets", evaluation["testset"].id)
    evaluation_uuid = generate_uuid()

    await store_mapping("human_evaluations", evaluation["_id"], evaluation_uuid)

    transformed_evaluation = {
        "id": evaluation_uuid,
        "app_id": app_uuid,
        "user_id": user_uuid,
        "status": evaluation["status"],
        "evaluation_type": evaluation["evaluation_type"],
        "testset_id": test_set_uuid,
        "created_at": get_datetime(evaluation.get("created_at")),
        "updated_at": get_datetime(evaluation.get("updated_at")),
    }

    associated_variants = await convert_human_evaluations_associated_variants(
        evaluation["variants"], evaluation["variants_revisions"], evaluation_uuid
    )

    return transformed_evaluation, associated_variants


async def transform_human_evaluation_scenario(scenario):
    user_uuid = await get_mapped_uuid("users", scenario["user"].id)
    evaluation_uuid = await get_mapped_uuid(
        "human_evaluations", scenario["evaluation"].id
    )
    scenario_uuid = generate_uuid()
    await store_mapping("human_evaluations_scenarios", scenario["_id"], scenario_uuid)
    return {
        "id": scenario_uuid,
        "user_id": user_uuid,
        "evaluation_id": evaluation_uuid,
        "inputs": scenario["inputs"],
        "outputs": scenario["outputs"],
        "vote": scenario.get("vote"),
        "score": scenario.get("score"),
        "correct_answer": scenario.get("correct_answer"),
        "created_at": get_datetime(scenario.get("created_at")),
        "updated_at": get_datetime(scenario.get("updated_at")),
        "is_pinned": scenario.get("is_pinned"),
        "note": scenario.get("note"),
    }


async def convert_aggregated_results(results, evaluation_id):
    """Convert evaluator_config ObjectIds in aggregated_results to UUIDs and structure them."""
    aggregated_results = []
    for result in results:
        evaluator_config_uuid = await get_mapped_uuid(
            "evaluators_configs", result["evaluator_config"]
        )
        result_uuid = generate_uuid()
        aggregated_results.append(
            {
                "id": result_uuid,
                "evaluation_id": evaluation_id,
                "evaluator_config_id": evaluator_config_uuid,
                "result": result["result"],
            }
        )
    return aggregated_results


async def convert_scenario_aggregated_results(results, scenario_id):
    """Convert evaluator_config ObjectIds in scenario aggregated_results to UUIDs and structure them."""
    scenario_aggregated_results = []
    for result in results:
        evaluator_config_uuid = await get_mapped_uuid(
            "evaluators_configs", result["evaluator_config"]
        )
        result_uuid = generate_uuid()
        scenario_aggregated_results.append(
            {
                "id": result_uuid,
                "evaluation_scenario_id": scenario_id,
                "evaluator_config_id": evaluator_config_uuid,
                "result": result["result"],
            }
        )
    return scenario_aggregated_results


async def transform_evaluation(evaluation):
    app_uuid = await get_mapped_uuid("app_db", evaluation["app"].id)
    user_uuid = await get_mapped_uuid("users", evaluation["user"].id)
    test_set_uuid = await get_mapped_uuid("testsets", evaluation["testset"].id)
    variant_uuid = await get_mapped_uuid("app_variants", evaluation["variant"])
    revision_uuid = await get_mapped_uuid(
        "app_variant_revisions", evaluation["variant_revision"]
    )
    evaluation_uuid = generate_uuid()

    await store_mapping("evaluations", evaluation["_id"], evaluation_uuid)

    transformed_evaluation = {
        "id": evaluation_uuid,
        "app_id": app_uuid,
        "user_id": user_uuid,
        "status": evaluation["status"],
        "testset_id": test_set_uuid,
        "variant_id": variant_uuid,
        "variant_revision_id": revision_uuid,
        "average_cost": evaluation["average_cost"],
        "total_cost": evaluation["total_cost"],
        "average_latency": evaluation["average_latency"],
        "created_at": get_datetime(evaluation.get("created_at")),
        "updated_at": get_datetime(evaluation.get("updated_at")),
    }

    aggregated_results = await convert_aggregated_results(
        evaluation["aggregated_results"], evaluation_uuid
    )

    return transformed_evaluation, aggregated_results


async def transform_evaluation_scenario(scenario):
    user_uuid = await get_mapped_uuid("users", scenario["user"].id)
    evaluation_uuid = await get_mapped_uuid("evaluations", scenario["evaluation"].id)
    variant_uuid = await get_mapped_uuid("app_variants", scenario["variant_id"])
    scenario_uuid = generate_uuid()

    await store_mapping("evaluation_scenarios", scenario["_id"], scenario_uuid)

    transformed_scenario = {
        "id": scenario_uuid,
        "user_id": user_uuid,
        "evaluation_id": evaluation_uuid,
        "variant_id": variant_uuid,
        "inputs": scenario["inputs"],
        "outputs": scenario["outputs"],
        "correct_answers": scenario.get("correct_answers"),
        "is_pinned": scenario.get("is_pinned"),
        "note": scenario.get("note"),
        "latency": scenario.get("latency"),
        "cost": scenario.get("cost"),
        "created_at": get_datetime(scenario.get("created_at")),
        "updated_at": get_datetime(scenario.get("updated_at")),
    }

    aggregated_results = []
    if "results" in scenario:
        aggregated_results = await convert_scenario_aggregated_results(
            scenario["results"], scenario_uuid
        )

    return transformed_scenario, aggregated_results


async def main():
    try:
        await drop_all_tables()
        await create_all_tables(tables=tables)
        await migrate_collection("users", UserDB, transform_user)
        await migrate_collection("docker_images", ImageDB, transform_image)
        await migrate_collection("app_db", AppDB, transform_app)
        await migrate_collection("deployments", DeploymentDB, transform_deployment)
        await migrate_collection("bases", VariantBaseDB, transform_variant_base)
        await migrate_collection("app_variants", AppVariantDB, transform_app_variant)
        await migrate_collection(
            "app_variant_revisions",
            AppVariantRevisionsDB,
            transform_app_variant_revision,
        )
        await migrate_collection(
            "environments", AppEnvironmentDB, transform_app_environment
        )
        await migrate_collection(
            "environments_revisions",
            AppEnvironmentRevisionDB,
            transform_app_environment_revision,
        )
        await migrate_collection("templates", TemplateDB, transform_template)
        await migrate_collection("testsets", TestSetDB, transform_test_set)
        await migrate_collection(
            "evaluators_configs", EvaluatorConfigDB, transform_evaluator_config
        )
        await migrate_collection(
            "human_evaluations",
            HumanEvaluationDB,
            transform_human_evaluation,
            HumanEvaluationVariantDB,
        )
        await migrate_collection(
            "human_evaluations_scenarios",
            HumanEvaluationScenarioDB,
            transform_human_evaluation_scenario,
        )
        await migrate_collection(
            "new_evaluations",
            EvaluationDB,
            transform_evaluation,
            EvaluationAggregatedResultDB,
        )
        await migrate_collection(
            "new_evaluation_scenarios",
            EvaluationScenarioDB,
            transform_evaluation_scenario,
            EvaluationScenarioResultDB,
        )
        print("\n ========================================================")
        print("Migration completed successfully.")
    except Exception as e:
        import traceback

        print(f"\n====================== Error ======================\n")
        print(f"Error occurred: {e}")
        traceback.print_exc()
    finally:
        print_migration_report()


if __name__ == "__main__":
    asyncio.run(main())
