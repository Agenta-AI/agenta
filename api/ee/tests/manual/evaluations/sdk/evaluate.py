from typing import Dict, List
from uuid import UUID
from copy import deepcopy

from definitions import (
    Origin,
    Link,
    Reference,
    SimpleEvaluationFlags,
    SimpleEvaluationStatus,
    SimpleEvaluationData,
    TestsetRevision,
    ApplicationRevision,
    EvaluatorRevision,
    WorkflowServiceData,
    ApplicationServiceRequest,
    ApplicationServiceResponse,
    EvaluatorServiceRequest,
    EvaluatorServiceResponse,
)
from evaluations import (
    create_run,
    add_scenario,
    log_result,
    compute_metrics,
    get_slug_from_name_and_id,
)

# from mock_entities import (
# upsert_testset,
# retrieve_testset,
# upsert_application,
# retrieve_application,
# upsert_evaluator,
# retrieve_evaluator,
# )

from entities import (
    upsert_testset,
    retrieve_testset,
    upsert_application,
    retrieve_application,
    upsert_evaluator,
    retrieve_evaluator,
)

from services import (
    invoke_application,
    invoke_evaluator,
)

EvaluateSpecs = SimpleEvaluationData


# @debug
async def evaluate(
    data: SimpleEvaluationData,
):
    data = deepcopy(data)

    if data.testset_steps:
        if isinstance(data.testset_steps, list):
            testset_steps: Dict[str, Origin] = {}

            if all(
                isinstance(testset_revision_id, UUID)
                for testset_revision_id in data.testset_steps
            ):
                for testset_revision_id in data.testset_steps:
                    if isinstance(testset_revision_id, UUID):
                        testset_steps[str(testset_revision_id)] = "custom"

            elif all(
                isinstance(testcases_data, List)
                for testcases_data in data.testset_steps
            ):
                for testcases_data in data.testset_steps:
                    if isinstance(testcases_data, List):
                        if all(isinstance(step, Dict) for step in testcases_data):
                            testset_revision_id = await upsert_testset(
                                testcases_data=testcases_data,
                            )
                            testset_steps[str(testset_revision_id)] = "custom"

            data.testset_steps = testset_steps

    if not data.testset_steps or not isinstance(data.testset_steps, dict):
        print("[failure] missing or invalid testset steps")
        return None

    if data.application_steps:
        if isinstance(data.application_steps, list):
            application_steps: Dict[str, Origin] = {}

            if all(
                isinstance(application_revision_id, UUID)
                for application_revision_id in data.application_steps
            ):
                for application_revision_id in data.application_steps:
                    if isinstance(application_revision_id, UUID):
                        application_steps[str(application_revision_id)] = "custom"

            elif all(
                callable(application_handler)
                for application_handler in data.application_steps
            ):
                for application_handler in data.application_steps:
                    if callable(application_handler):
                        application_revision_id = await upsert_application(
                            application_handler=application_handler,
                        )
                        application_steps[str(application_revision_id)] = "custom"

            data.application_steps = application_steps

    if not data.application_steps or not isinstance(data.application_steps, dict):
        print("[failure] missing or invalid application steps")
        return None

    if data.evaluator_steps:
        if isinstance(data.evaluator_steps, list):
            evaluator_steps: Dict[str, Origin] = {}

            if all(
                isinstance(evaluator_revision_id, UUID)
                for evaluator_revision_id in data.evaluator_steps
            ):
                for evaluator_revision_id in data.evaluator_steps:
                    if isinstance(evaluator_revision_id, UUID):
                        evaluator_steps[str(evaluator_revision_id)] = "custom"

            elif all(
                callable(evaluator_handler)
                for evaluator_handler in data.evaluator_steps
            ):
                for evaluator_handler in data.evaluator_steps:
                    if callable(evaluator_handler):
                        evaluator_revision_id = await upsert_evaluator(
                            evaluator_handler=evaluator_handler,
                        )
                        evaluator_steps[str(evaluator_revision_id)] = "custom"

            data.evaluator_steps = evaluator_steps

    if not data.evaluator_steps or not isinstance(data.evaluator_steps, dict):
        print("[failure] missing or invalid evaluator steps")
        return None

    testsets: Dict[UUID, TestsetRevision] = {}
    for testset_revision_id, origin in data.testset_steps.items():
        testset_revision = await retrieve_testset(
            testset_revision_id=testset_revision_id,
        )

        if not testset_revision:
            continue

        testsets[testset_revision_id] = testset_revision

    applications: Dict[UUID, ApplicationRevision] = {}
    for application_revision_id, origin in data.application_steps.items():
        application_revision = await retrieve_application(
            application_revision_id=application_revision_id,
        )

        if not application_revision:
            continue

        applications[application_revision_id] = application_revision

    evaluators: Dict[UUID, EvaluatorRevision] = {}
    for evaluator_revision_id, origin in data.evaluator_steps.items():
        evaluator_revision = await retrieve_evaluator(
            evaluator_revision_id=evaluator_revision_id,
        )

        if not evaluator_revision:
            continue

        evaluators[evaluator_revision_id] = evaluator_revision

    run = await create_run(
        testset_steps=data.testset_steps,
        application_steps=data.application_steps,
        evaluator_steps=data.evaluator_steps,
    )

    if not run.id:
        print("[failure] could not create evaluation")
        return None

    scenarios = list()

    for testset_revision_id, testset_revision in testsets.items():
        if not testset_revision.data or not testset_revision.data.testcases:
            continue

        testcases = testset_revision.data.testcases

        print()
        print(f"From testset_id={str(testset_revision.testset_id)}")

        for testcase in testcases:
            print(f"Evaluating      testcase_id={str(testcase.id)}")
            scenario = await add_scenario(
                run_id=run.id,
            )

            results = dict()

            result = await log_result(
                run_id=run.id,
                scenario_id=scenario.id,
                step_key="testset-" + testset_revision.slug,  # type: ignore
                testcase_id=testcase.id,
            )

            results[testset_revision.slug] = result

            for application_revision_id, application_revision in applications.items():
                if not application_revision or not application_revision.data:
                    print("Missing or invalid application revision")
                    continue

                application_request = ApplicationServiceRequest(
                    data=WorkflowServiceData(
                        parameters=application_revision.data.parameters,
                        inputs=testcase.data,
                    ),
                    references=dict(
                        testset_revision=Reference(
                            id=testset_revision.id,
                            slug=testset_revision.slug,
                            version=testset_revision.version,
                        ),
                        application_revision=Reference(
                            id=application_revision.id,
                            slug=application_revision.slug,
                            version=application_revision.version,
                        ),
                    ),
                )

                application_response = await invoke_application(
                    request=application_request,
                    revision=application_revision,
                )

                if (
                    not application_response
                    or not application_response.data
                    or not application_response.trace_id
                ):
                    print("Missing or invalid application response")
                    continue

                trace_id = application_response.trace_id

                if not application_revision.id or not application_revision.name:
                    print("Missing application revision ID or name")
                    continue

                application_slug = get_slug_from_name_and_id(
                    name=application_revision.name,
                    id=application_revision.id,
                )

                result = await log_result(
                    run_id=run.id,
                    scenario_id=scenario.id,
                    step_key="application-" + application_slug,  # type: ignore
                    trace_id=trace_id,
                )

                results[application_slug] = result

                for evaluator_revision_id, evaluator_revision in evaluators.items():
                    if not evaluator_revision or not evaluator_revision.data:
                        print("Missing or invalid evaluator revision")
                        continue

                    evaluator_request = EvaluatorServiceRequest(
                        data=WorkflowServiceData(
                            parameters=evaluator_revision.data.parameters,
                            inputs=testcase.data,
                            #
                            trace_outputs=application_response.data.outputs,
                            trace=application_response.data.trace,
                        ),
                        references=dict(
                            testset_revision=Reference(
                                id=testset_revision.id,
                                slug=testset_revision.slug,
                                version=testset_revision.version,
                            ),
                            evaluator_revision=Reference(
                                id=evaluator_revision.id,
                                slug=evaluator_revision.slug,
                                version=evaluator_revision.version,
                            ),
                        ),
                        links=application_response.links,
                    )

                    evaluator_response = await invoke_evaluator(
                        request=evaluator_request,
                        revision=evaluator_revision,
                    )

                    if not evaluator_response or not evaluator_response.data:
                        print("Missing or invalid evaluator response")
                        continue

                    trace_id = evaluator_response.trace_id

                    result = await log_result(
                        run_id=run.id,
                        scenario_id=scenario.id,
                        step_key="evaluator-" + evaluator_revision.slug,  # type: ignore
                        trace_id=trace_id,
                    )

                    results[evaluator_revision.slug] = result

            scenarios.append(
                {
                    "scenario": scenario,
                    "results": results,
                },
            )

    metrics = await compute_metrics(
        run_id=run.id,
    )

    return dict(
        run=run,
        scenarios=scenarios,
        metrics=metrics,
    )
