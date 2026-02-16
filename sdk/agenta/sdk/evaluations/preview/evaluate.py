from typing import Dict, List, Any, Union, Optional, Tuple
from uuid import UUID
from copy import deepcopy
from datetime import datetime

from pydantic import BaseModel

from agenta.sdk.models.evaluations import (
    Origin,
    Target,
    Link,
    Reference,
    SimpleEvaluationData,
)
from agenta.sdk.models.workflows import (
    ApplicationRevision,
    EvaluatorRevision,
    WorkflowServiceRequestData,
    ApplicationServiceRequest,
    EvaluatorServiceRequest,
)
from agenta.sdk.models.testsets import TestsetRevision

from agenta.sdk.utils.references import get_slug_from_name_and_id
from agenta.sdk.evaluations.preview.utils import fetch_trace_data

from agenta.sdk.managers.testsets import (
    acreate as acreate_testset,
    aretrieve as aretrieve_testset,
)
from agenta.sdk.managers.applications import (
    aupsert as aupsert_application,
    aretrieve as aretrieve_application,
)
from agenta.sdk.managers.evaluators import (
    aupsert as aupsert_evaluator,
    aretrieve as aretrieve_evaluator,
)
from agenta.sdk.evaluations.runs import (
    acreate as acreate_run,
    aclose as aclose_run,
    aurl as aget_url,
)
from agenta.sdk.evaluations.scenarios import (
    acreate as aadd_scenario,
)
from agenta.sdk.evaluations.results import (
    acreate as alog_result,
)
from agenta.sdk.evaluations.metrics import (
    arefresh as acompute_metrics,
)


from agenta.sdk.models.workflows import (
    WorkflowServiceInterface,
    WorkflowServiceConfiguration,
)
from agenta.sdk.decorators.running import (
    invoke_application,
    invoke_evaluator,
)


class EvaluateSpecs(BaseModel):
    testsets: Optional[Target] = None
    applications: Optional[Target] = None
    evaluators: Optional[Target] = None

    repeats: Optional[int] = None


async def _parse_evaluate_kwargs(
    *,
    testsets: Optional[Target] = None,
    applications: Optional[Target] = None,
    evaluators: Optional[Target] = None,
    #
    repeats: Optional[int] = None,
    #
    specs: Optional[Union[EvaluateSpecs, Dict[str, Any]]] = None,
) -> SimpleEvaluationData:
    _specs = deepcopy(specs)
    if isinstance(_specs, dict):
        _specs = EvaluateSpecs(**_specs)
    if _specs and not isinstance(_specs, EvaluateSpecs):
        _specs = None

    simple_evaluation_data = SimpleEvaluationData(
        testset_steps=testsets or (_specs.testsets if _specs else None),
        application_steps=applications or (_specs.applications if _specs else None),
        evaluator_steps=evaluators or (_specs.evaluators if _specs else None),
        #
        repeats=repeats or (_specs.repeats if _specs else None),
    )

    if not simple_evaluation_data.testset_steps:
        raise ValueError("Invalid 'evaluate()' specs: missing testsets")
    if not simple_evaluation_data.application_steps:
        raise ValueError("Invalid 'evaluate()' specs: missing applications")
    if not simple_evaluation_data.evaluator_steps:
        raise ValueError("Invalid 'evaluate()' specs: missing evaluators")

    return simple_evaluation_data


async def _upsert_entities(
    simple_evaluation_data: SimpleEvaluationData,
) -> SimpleEvaluationData:
    if simple_evaluation_data.testset_steps:
        if isinstance(simple_evaluation_data.testset_steps, list):
            testset_steps: Dict[str, Origin] = {}

            if all(
                isinstance(testset_revision_id, UUID)
                for testset_revision_id in simple_evaluation_data.testset_steps
            ):
                for testset_revision_id in simple_evaluation_data.testset_steps:
                    if isinstance(testset_revision_id, UUID):
                        testset_steps[str(testset_revision_id)] = "custom"

            elif all(
                isinstance(testcases_data, List)
                for testcases_data in simple_evaluation_data.testset_steps
            ):
                for testcases_data in simple_evaluation_data.testset_steps:
                    if isinstance(testcases_data, List):
                        if all(isinstance(step, Dict) for step in testcases_data):
                            testset_revision_id = await acreate_testset(
                                data=testcases_data,
                            )
                            testset_steps[str(testset_revision_id)] = "custom"

            simple_evaluation_data.testset_steps = testset_steps

    if not simple_evaluation_data.testset_steps or not isinstance(
        simple_evaluation_data.testset_steps, dict
    ):
        raise ValueError(
            "Invalid 'evaluate()' specs: missing or invalid testset steps",
        )

    if simple_evaluation_data.application_steps:
        if isinstance(simple_evaluation_data.application_steps, list):
            application_steps: Dict[str, Origin] = {}

            if all(
                isinstance(application_revision_id, UUID)
                for application_revision_id in simple_evaluation_data.application_steps
            ):
                for application_revision_id in simple_evaluation_data.application_steps:
                    if isinstance(application_revision_id, UUID):
                        application_steps[str(application_revision_id)] = "custom"

            elif all(
                callable(application_handler)
                for application_handler in simple_evaluation_data.application_steps
            ):
                for application_handler in simple_evaluation_data.application_steps:
                    if callable(application_handler):
                        application_revision_id = await aupsert_application(
                            handler=application_handler,
                        )
                        application_steps[str(application_revision_id)] = "custom"

            simple_evaluation_data.application_steps = application_steps

    if not simple_evaluation_data.application_steps or not isinstance(
        simple_evaluation_data.application_steps, dict
    ):
        raise ValueError(
            "Invalid 'evaluate()' specs: missing or invalid application steps",
        )

    if simple_evaluation_data.evaluator_steps:
        if isinstance(simple_evaluation_data.evaluator_steps, list):
            evaluator_steps: Dict[str, Origin] = {}

            if all(
                isinstance(evaluator_revision_id, UUID)
                for evaluator_revision_id in simple_evaluation_data.evaluator_steps
            ):
                for evaluator_revision_id in simple_evaluation_data.evaluator_steps:
                    if isinstance(evaluator_revision_id, UUID):
                        evaluator_steps[str(evaluator_revision_id)] = "custom"

            elif all(
                callable(evaluator_handler)
                for evaluator_handler in simple_evaluation_data.evaluator_steps
            ):
                for evaluator_handler in simple_evaluation_data.evaluator_steps:
                    if callable(evaluator_handler):
                        evaluator_revision_id = await aupsert_evaluator(
                            handler=evaluator_handler,
                        )
                        evaluator_steps[str(evaluator_revision_id)] = "custom"

            simple_evaluation_data.evaluator_steps = evaluator_steps

    if not simple_evaluation_data.evaluator_steps or not isinstance(
        simple_evaluation_data.evaluator_steps, dict
    ):
        raise ValueError(
            "Invalid 'evaluate()' specs: missing or invalid evaluator steps",
        )

    return simple_evaluation_data


async def _retrieve_entities(
    simple_evaluation_data: SimpleEvaluationData,
) -> Tuple[
    Dict[UUID, TestsetRevision],
    Dict[UUID, ApplicationRevision],
    Dict[UUID, EvaluatorRevision],
]:
    testset_revisions: Dict[UUID, TestsetRevision] = {}
    # for testset_revision_id, origin in simple_evaluation_data.testset_steps.items():
    #     testset_revision = await retrieve_testset(
    #         testset_revision_id=testset_revision_id,
    #     )
    for testset_id, origin in simple_evaluation_data.testset_steps.items():
        testset_revision = await aretrieve_testset(
            testset_id=testset_id,
        )

        if not testset_revision or not testset_revision.id:
            continue

        testset_revisions[testset_revision.id] = testset_revision

    application_revisions: Dict[UUID, ApplicationRevision] = {}
    for (
        application_revision_id,
        origin,
    ) in simple_evaluation_data.application_steps.items():
        application_revision = await aretrieve_application(
            application_revision_id=application_revision_id,
        )

        if not application_revision:
            continue

        application_revisions[application_revision_id] = application_revision

    evaluator_revisions: Dict[UUID, EvaluatorRevision] = {}
    for evaluator_revision_id, origin in simple_evaluation_data.evaluator_steps.items():
        evaluator_revision = await aretrieve_evaluator(
            evaluator_revision_id=evaluator_revision_id,
        )

        if not evaluator_revision:
            continue

        evaluator_revisions[evaluator_revision_id] = evaluator_revision

    return testset_revisions, application_revisions, evaluator_revisions


def _timestamp_suffix():
    suffix = datetime.now().strftime("%y-%m-%d · %H:%M")
    return f" [{suffix}]"


UNICODE = {
    "here": "•  ",
    "root": "┌─ ",
    "next": "├─ ",
    "last": "└─ ",
    "pipe": "│  ",
    "skip": "   ",
    "this": "── ",
}


# @debug
async def aevaluate(
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    testsets: Optional[Target] = None,
    applications: Optional[Target] = None,
    evaluators: Optional[Target] = None,
    #
    repeats: Optional[int] = None,
    #
    specs: Optional[Union[EvaluateSpecs, Dict[str, Any]]] = None,
):
    simple_evaluation_data = await _parse_evaluate_kwargs(
        testsets=testsets,
        applications=applications,
        evaluators=evaluators,
        repeats=repeats,
        specs=specs,
    )

    simple_evaluation_data = await _upsert_entities(
        simple_evaluation_data=simple_evaluation_data,
    )

    print()
    print(
        "────────────────────────────────────────────────────────────────────────────"
    )
    print(f"Evaluation running...")
    print(
        "────────────────────────────────────────────────────────────────────────────"
    )

    suffix = _timestamp_suffix()
    name = f"{name}{suffix}"

    run = await acreate_run(
        name=name,
        description=description,
        #
        testset_steps=simple_evaluation_data.testset_steps,
        application_steps=simple_evaluation_data.application_steps,
        evaluator_steps=simple_evaluation_data.evaluator_steps,
        #
        repeats=simple_evaluation_data.repeats,
    )

    print(
        f"{UNICODE['here']}"
        f"{UNICODE['skip']}"
        f"{UNICODE['skip']}"
        f"{UNICODE['skip']}"
        f"{UNICODE['skip']}"
        f"     run_id={str(run.id)}",
    )

    if not run.id:
        print("[failure] could not create evaluation")
        return None

    (
        testset_revisions,
        application_revisions,
        evaluator_revisions,
    ) = await _retrieve_entities(
        simple_evaluation_data=simple_evaluation_data,
    )

    scenarios = list()

    metrics = dict()

    for testset_revision in testset_revisions.values():
        if not testset_revision.data or not testset_revision.data.testcases:
            continue

        testcases = testset_revision.data.testcases

        print(
            f"{UNICODE['next']}"
            f"{UNICODE['here']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            f" testset_id={str(testset_revision.testset_id)}",
        )

        for testcase_idx, testcase in enumerate(testcases):
            print(
                f"{UNICODE['pipe']}"
                f"{UNICODE['pipe']}"
                f"{UNICODE['skip']}"
                f"{UNICODE['skip']}"
                f"{UNICODE['skip']}"
                "-----------------------"
                "--------------------------------------"
            )

            print(
                f"{UNICODE['pipe']}"
                f"{UNICODE['next' if testcase_idx < len(testcases) - 1 else 'last']}"
                f"{UNICODE['here']}"
                f"{UNICODE['skip']}"
                f"{UNICODE['skip']}"
                f"testcase_id={str(testcase.id)}",
            )

            scenario = await aadd_scenario(
                run_id=run.id,
            )

            print(
                f"{UNICODE['pipe']}"
                f"{UNICODE['pipe' if testcase_idx < len(testcases) - 1 else 'skip']}"
                f"{UNICODE['next']}"
                f"{UNICODE['here']}"
                f"{UNICODE['skip']}"
                f"scenario_id={str(scenario.id)}",
            )

            results = dict()

            result = await alog_result(
                run_id=run.id,
                scenario_id=scenario.id,
                step_key="testset-" + testset_revision.slug,  # type: ignore
                testcase_id=testcase.id,
            )

            print(
                f"{UNICODE['pipe']}"
                f"{UNICODE['pipe' if testcase_idx < len(testcases) - 1 else 'skip']}"
                f"{UNICODE['pipe']}"
                f"{UNICODE['next']}"
                f"{UNICODE['here']}"
                f"  result_id={str(result.id)} (testcase)",
            )

            results[testset_revision.slug] = result

            _testcase = testcase.model_dump(
                mode="json",
                exclude_none=True,
            )  # type: ignore
            inputs = testcase.data
            if isinstance(inputs, dict):
                if "testcase_dedup_id" in inputs:
                    del inputs["testcase_dedup_id"]

            for application_revision in application_revisions.values():
                if not application_revision or not application_revision.data:
                    print("Missing or invalid application revision")
                    if application_revision:
                        print(application_revision.model_dump(exclude_none=True))
                    continue

                # print(f"  Application   {application_revision.model_dump(exclude_none=True)}")  # type: ignore

                references = dict(
                    testset=Reference(
                        id=testset_revision.testset_id,
                    ),
                    testset_variant=Reference(
                        id=testset_revision.testset_variant_id,
                    ),
                    testset_revision=Reference(
                        id=testset_revision.id,
                        slug=testset_revision.slug,
                        version=testset_revision.version,
                    ),
                    application=Reference(
                        id=application_revision.application_id,
                    ),
                    application_variant=Reference(
                        id=application_revision.application_variant_id,
                    ),
                    application_revision=Reference(
                        id=application_revision.id,
                        slug=application_revision.slug,
                        version=application_revision.version,
                    ),
                )
                links = None

                _revision = application_revision.model_dump(
                    mode="json",
                    exclude_none=True,
                )
                interface = WorkflowServiceInterface(
                    **(
                        application_revision.data.model_dump()
                        if application_revision.data
                        else {}
                    )
                )
                configuration = WorkflowServiceConfiguration(
                    **(
                        application_revision.data.model_dump()
                        if application_revision.data
                        else {}
                    )
                )
                parameters = application_revision.data.parameters

                _trace = None
                outputs = None

                workflow_service_request_data = WorkflowServiceRequestData(
                    revision=_revision,
                    parameters=parameters,
                    #
                    testcase=_testcase,
                    inputs=inputs,
                    #
                    trace=_trace,
                    outputs=outputs,
                )

                application_request = ApplicationServiceRequest(
                    interface=interface,
                    configuration=configuration,
                    #
                    data=workflow_service_request_data,
                    #
                    references=references,  # type: ignore
                    links=links,  # type: ignore
                )

                application_response = await invoke_application(
                    request=application_request,
                )

                if (
                    not application_response
                    or not application_response.data
                    or not application_response.trace_id
                ):
                    print("Missing or invalid application response")
                    if application_response:
                        print(application_response.model_dump(exclude_none=True))
                    continue

                trace_id = application_response.trace_id

                if not application_revision.id or not application_revision.name:
                    print("Missing application revision ID or name")
                    continue

                application_slug = get_slug_from_name_and_id(
                    name=application_revision.name,
                    id=application_revision.id,
                )

                trace = fetch_trace_data(trace_id, max_retries=30, delay=1.0)

                result = await alog_result(
                    run_id=run.id,
                    scenario_id=scenario.id,
                    step_key="application-" + application_slug,  # type: ignore
                    trace_id=trace_id,
                )

                print(
                    f"{UNICODE['pipe']}"
                    f"{UNICODE['pipe' if testcase_idx < len(testcases) - 1 else 'skip']}"
                    f"{UNICODE['pipe']}"
                    f"{UNICODE['next']}"
                    f"{UNICODE['here']}"
                    f"  result_id={str(result.id)} (invocation)",
                )

                results[application_slug] = result

                trace = await trace

                if not trace:
                    print("Failed to fetch trace data for application")
                    continue

                root_span = list(trace.get("spans", {}).values())[0]
                trace_attributes: dict = root_span.get("attributes", {})
                trace_attributes_ag: dict = trace_attributes.get("ag", {})
                trace_attributes_ag_data: dict = trace_attributes_ag.get("data", {})
                outputs = trace_attributes_ag_data.get("outputs")
                inputs = inputs or trace_attributes_ag_data.get("inputs")

                for i, evaluator_revision in enumerate(evaluator_revisions.values()):
                    if not evaluator_revision or not evaluator_revision.data:
                        print("Missing or invalid evaluator revision")
                        if evaluator_revision:
                            print(evaluator_revision.model_dump(exclude_none=True))
                        continue

                    references = dict(
                        testset=Reference(
                            id=testset_revision.testset_id,
                        ),
                        testset_variant=Reference(
                            id=testset_revision.testset_variant_id,
                        ),
                        testset_revision=Reference(
                            id=testset_revision.id,
                            slug=testset_revision.slug,
                            version=testset_revision.version,
                        ),
                        evaluator=Reference(
                            id=evaluator_revision.evaluator_id,
                        ),
                        evaluator_variant=Reference(
                            id=evaluator_revision.evaluator_variant_id,
                        ),
                        evaluator_revision=Reference(
                            id=evaluator_revision.id,
                            slug=evaluator_revision.slug,
                            version=evaluator_revision.version,
                        ),
                    )
                    links = (
                        dict(
                            invocation=Link(
                                trace_id=application_response.trace_id,
                                span_id=application_response.span_id,
                            )
                        )
                        if application_response.trace_id
                        and application_response.span_id
                        else None
                    )

                    _revision = evaluator_revision.model_dump(
                        mode="json",
                        exclude_none=True,
                    )
                    interface = WorkflowServiceInterface(
                        **(
                            evaluator_revision.data.model_dump()
                            if evaluator_revision.data
                            else {}
                        )
                    )
                    configuration = WorkflowServiceConfiguration(
                        **(
                            evaluator_revision.data.model_dump()
                            if evaluator_revision.data
                            else {}
                        )
                    )
                    parameters = evaluator_revision.data.parameters

                    workflow_service_request_data = WorkflowServiceRequestData(
                        revision=_revision,
                        parameters=parameters,
                        #
                        testcase=_testcase,
                        inputs=inputs,
                        #
                        trace=trace,
                        outputs=outputs,
                    )

                    evaluator_request = EvaluatorServiceRequest(
                        version="2025.07.14",
                        #
                        interface=interface,
                        configuration=configuration,
                        #
                        data=workflow_service_request_data,
                        #
                        references=references,  # type: ignore
                        links=links,  # type: ignore
                    )

                    evaluator_response = await invoke_evaluator(
                        request=evaluator_request,
                        #
                        annotate=True,
                    )

                    if (
                        not evaluator_response
                        or not evaluator_response.data
                        or not evaluator_response.trace_id
                    ):
                        print("Missing or invalid evaluator response")
                        if evaluator_response:
                            print(evaluator_response.model_dump(exclude_none=True))
                        continue

                    trace_id = evaluator_response.trace_id

                    trace = fetch_trace_data(trace_id, max_retries=20, delay=1.0)

                    result = await alog_result(
                        run_id=run.id,
                        scenario_id=scenario.id,
                        step_key="evaluator-" + evaluator_revision.slug,  # type: ignore
                        trace_id=trace_id,
                    )

                    print(
                        f"{UNICODE['pipe']}"
                        f"{UNICODE['pipe' if testcase_idx < len(testcases) - 1 else 'skip']}"
                        f"{UNICODE['pipe']}"
                        f"{UNICODE['last' if (i == len(evaluator_revisions) - 1) else 'next']}"
                        f"{UNICODE['here']}"
                        f"  result_id={str(result.id)} (annotation)",
                    )

                    results[evaluator_revision.slug] = result

                    trace = await trace

                    if not trace:
                        print("Failed to fetch trace data for evaluator")
                        continue

            metrics = await acompute_metrics(
                run_id=run.id,
                scenario_id=scenario.id,
            )

            print(
                f"{UNICODE['pipe']}"
                f"{UNICODE['pipe' if testcase_idx < len(testcases) - 1 else 'skip']}"
                f"{UNICODE['last']}"
                f"{UNICODE['here']}"
                f"{UNICODE['skip']}"
                f" metrics_id={str(metrics.id)}",
            )

            scenarios.append(
                {
                    "scenario": scenario,
                    "results": results,
                    "metrics": metrics,
                },
            )

        print(
            f"{UNICODE['pipe']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            "-----------------------"
            "--------------------------------------"
        )

    metrics = dict()

    if len(scenarios) > 0:
        metrics = await acompute_metrics(
            run_id=run.id,
        )

        print(
            f"{UNICODE['last']}"
            f"{UNICODE['here']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            f" metrics_id={str(metrics.id)}",
        )

    run = await aclose_run(
        run_id=run.id,
    )

    run_url = await aget_url(run_id=run.id)

    print(
        "────────────────────────────────────────────────────────────────────────────"
    )
    print(f"Evaluation finished.")
    print(
        "----------------------------------------------------------------------------"
    )
    print(f"Evaluation URL: {run_url or '[unavailable]'}")
    print(
        "────────────────────────────────────────────────────────────────────────────"
    )
    print()

    return dict(
        run=run,
        scenarios=scenarios,
        metrics=metrics,
    )
