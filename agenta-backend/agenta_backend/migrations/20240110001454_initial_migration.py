from agenta_backend.models.db_models import (
    AppDB,
    OrganizationDB,
    UserDB,
    TestSetDB,
    EvaluationDB,
    EvaluationScenarioDB,
    EvaluationScenarioInputDB,
    EvaluationScenarioOutputDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    HumanEvaluationScenarioInput,
    HumanEvaluationScenarioOutput,
    OldEvaluationDB,
    OldEvaluationScenarioDB,
)

from beanie import free_fall_migration, Link


class Forward:
    @free_fall_migration(document_models=[OldEvaluationDB, EvaluationDB])
    async def move_old_evals_to_new_evals_document(self, session):
        async for old_eval in OldEvaluationDB.find_all():
            eval_config = EvaluatorConfigDB(
                app=Link(AppDB, old_eval.app.id),
                organization=Link(OrganizationDB, old_eval.organization.id),
                user=Link(UserDB, old_eval.user.id),
                evaluator_key=old_eval.evaluation_type,
                settings_values={},
            )
            await eval_config.create()
            if old_eval.evaluation_type in ["human_a_b_testing", "single_model_test"]:
                new_eval = HumanEvaluationDB(
                    app=Link(AppDB, old_eval.app.id),
                    organization=Link(OrganizationDB, old_eval.organization.id),
                    user=Link(UserDB, old_eval.user.id),
                    status=old_eval.status,
                    evaluation_type=old_eval.evaluation_type,
                    variants=old_eval.variants,
                    testset=Link(TestSetDB, old_eval.testset.id),
                )
            else:
                new_eval = EvaluationDB(
                    app=Link(AppDB, old_eval.app.id),
                    organization=Link(OrganizationDB, old_eval.organization.id),
                    user=Link(UserDB, old_eval.user.id),
                    status=old_eval.status,
                    testset=Link(TestSetDB, old_eval.testset.id),
                    variant=old_eval.variants[0],
                    evaluator_configs=eval_config.id,
                    aggregated_results=[],
                )
            await old_eval.delete()
            await new_eval.replace(session=session)

    @free_fall_migration(
        document_models=[OldEvaluationScenarioDB, EvaluationScenarioDB]
    )
    async def move_old_eval_scenarios_to_new_eval_scenarios(self, session):
        async for old_scenario in OldEvaluationScenarioDB.find_all():
            if old_scenario.evaluation_type in [
                "human_a_b_testing",
                "single_model_test",
            ]:
                new_scenario = HumanEvaluationScenarioDB(
                    user=Link(UserDB, old_scenario.user.id),
                    organization=Link(OrganizationDB, old_scenario.organization.id),
                    evaluation=Link(EvaluationDB, old_scenario.evaluation.id),
                    inputs=[
                        HumanEvaluationScenarioInput(
                            name=input.input_name,
                            value=input.input_value,
                        )
                        for input in old_scenario.inputs
                    ],
                    outputs=[
                        HumanEvaluationScenarioOutput(
                            variant_id=output.variant_id,
                            variant_output=output.variant_output,
                        )
                        for output in old_scenario.outputs
                    ],
                    correct_answer=old_scenario.correct_answer,
                    is_pinned=old_scenario.is_pinned,
                    note=old_scenario.note,
                    vote=old_scenario.vote,
                    score=old_scenario.score,
                )
            else:
                new_scenario = EvaluationScenarioDB(
                    user=Link(UserDB, old_scenario.user.id),
                    organization=Link(OrganizationDB, old_scenario.organization.id),
                    evaluation=Link(EvaluationDB, old_scenario.evaluation.id),
                    variant_id=old_scenario.evaluation.variants[0],
                    inputs=[
                        EvaluationScenarioInputDB(
                            name=input.input_name,
                            type=type(input.input_value).__name__,
                            value=input.input_value,
                        )
                        for input in old_scenario.inputs
                    ],
                    outputs=[
                        EvaluationScenarioOutputDB(
                            type=type(output.variant_output).__name__,
                            value=output.variant_output,
                        )
                        for output in old_scenario.outputs
                    ],
                    correct_answer=old_scenario.correct_answer,
                    is_pinned=old_scenario.is_pinned,
                    note=old_scenario.note,
                    evaluators_configs=old_scenario.evaluation.evaluators_configs,
                    results=[],
                )
            await old_scenario.delete()
            await new_scenario.replace(session=session)


class Backward:
    ...
