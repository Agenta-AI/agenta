from typing import Dict, List, Any, Union, Optional, Tuple
from uuid import UUID
from copy import deepcopy
from datetime import datetime

from pydantic import BaseModel

from agenta.sdk.models.evaluations import (
    Origin,
    Target,
    SimpleEvaluationData,
)
from agenta.sdk.models.shared import Reference
from agenta.sdk.models.workflows import (
    ApplicationRevision,
    EvaluatorRevision,
)
from agenta.sdk.models.testsets import TestsetRevision

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
from agenta.sdk.evaluations.metrics import (
    arefresh as acompute_metrics,
)
from agenta.sdk.evaluations.runtime.models import EvaluationStep, ResolvedSourceItem
from agenta.sdk.evaluations.runtime.source_slice import process_evaluation_source_slice
from agenta.sdk.evaluations.runtime.adapters import (
    SdkLocalApplicationRunner,
    SdkLocalEvaluatorRunner,
    SdkResultLogger,
    SdkTraceLoader,
)


from agenta.sdk.utils.logging import get_module_logger


log = get_module_logger(__name__)


class EvaluateSpecs(BaseModel):
    testsets: Optional[Target] = None
    applications: Optional[Target] = None
    evaluators: Optional[Target] = None

    repeats: Optional[int] = None


_ALLOWED_ORIGINS = {"custom", "human", "auto"}


def _normalize_step_id(step_id: Any) -> Optional[str]:
    if step_id is None:
        return None

    if isinstance(step_id, UUID):
        return str(step_id)

    try:
        return str(UUID(str(step_id)))
    except Exception:
        log.warning(
            "Ignoring invalid evaluate() step id. Expected UUID-compatible value, got %r",
            step_id,
        )
        return None


def _normalize_target_steps(
    *,
    steps: Any,
    step_name: str,
) -> Dict[str, Origin]:
    if not steps or not isinstance(steps, dict):
        raise ValueError(
            f"Invalid 'evaluate()' specs: missing or invalid {step_name}",
        )

    normalized_steps: Dict[str, Origin] = {}
    invalid_step_ids = 0
    invalid_origins = 0

    for step_id, origin in steps.items():
        normalized_step_id = _normalize_step_id(step_id)
        if not normalized_step_id:
            invalid_step_ids += 1
            continue

        if not isinstance(origin, str) or origin not in _ALLOWED_ORIGINS:
            invalid_origins += 1
            continue

        normalized_steps[normalized_step_id] = origin

    if invalid_step_ids or invalid_origins:
        errors: List[str] = []
        if invalid_step_ids:
            errors.append(f"{invalid_step_ids} invalid id(s)")
        if invalid_origins:
            errors.append(
                f"{invalid_origins} invalid origin(s) among entries with valid id(s)"
            )

        raise ValueError(
            f"Invalid 'evaluate()' specs: invalid {step_name} ({', '.join(errors)})",
        )

    if not normalized_steps:
        raise ValueError(
            f"Invalid 'evaluate()' specs: missing or invalid {step_name}",
        )

    return normalized_steps


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
                            created_revision = await acreate_testset(
                                data=testcases_data,
                            )
                            if created_revision and created_revision.id:
                                normalized_revision_id = _normalize_step_id(
                                    created_revision.id
                                )
                                if normalized_revision_id:
                                    testset_steps[normalized_revision_id] = "custom"

            simple_evaluation_data.testset_steps = testset_steps

    simple_evaluation_data.testset_steps = _normalize_target_steps(
        steps=simple_evaluation_data.testset_steps,
        step_name="testset steps",
    )

    if simple_evaluation_data.application_steps:
        if isinstance(simple_evaluation_data.application_steps, list):
            application_steps: Dict[str, Origin] = {}

            if all(
                isinstance(application_revision_id, UUID)
                for application_revision_id in simple_evaluation_data.application_steps
            ):
                for application_revision_id in simple_evaluation_data.application_steps:
                    normalized_revision_id = _normalize_step_id(application_revision_id)
                    if normalized_revision_id:
                        application_steps[normalized_revision_id] = "custom"

            elif all(
                callable(application_handler)
                for application_handler in simple_evaluation_data.application_steps
            ):
                for application_handler in simple_evaluation_data.application_steps:
                    if callable(application_handler):
                        application_revision_id = await aupsert_application(
                            handler=application_handler,
                        )
                        normalized_revision_id = _normalize_step_id(
                            application_revision_id
                        )
                        if not normalized_revision_id:
                            raise ValueError(
                                "Invalid 'evaluate()' specs: failed to upsert application",
                            )

                        application_steps[normalized_revision_id] = "custom"

            simple_evaluation_data.application_steps = application_steps

    simple_evaluation_data.application_steps = _normalize_target_steps(
        steps=simple_evaluation_data.application_steps,
        step_name="application steps",
    )

    if simple_evaluation_data.evaluator_steps:
        if isinstance(simple_evaluation_data.evaluator_steps, list):
            evaluator_steps: Dict[str, Origin] = {}

            if all(
                isinstance(evaluator_revision_id, UUID)
                for evaluator_revision_id in simple_evaluation_data.evaluator_steps
            ):
                for evaluator_revision_id in simple_evaluation_data.evaluator_steps:
                    normalized_revision_id = _normalize_step_id(evaluator_revision_id)
                    if normalized_revision_id:
                        evaluator_steps[normalized_revision_id] = "custom"

            elif all(
                callable(evaluator_handler)
                for evaluator_handler in simple_evaluation_data.evaluator_steps
            ):
                for evaluator_handler in simple_evaluation_data.evaluator_steps:
                    if callable(evaluator_handler):
                        evaluator_revision_id = await aupsert_evaluator(
                            handler=evaluator_handler,
                        )
                        normalized_revision_id = _normalize_step_id(
                            evaluator_revision_id
                        )
                        if not normalized_revision_id:
                            raise ValueError(
                                "Invalid 'evaluate()' specs: failed to upsert evaluator",
                            )

                        evaluator_steps[normalized_revision_id] = "custom"

            simple_evaluation_data.evaluator_steps = evaluator_steps

    simple_evaluation_data.evaluator_steps = _normalize_target_steps(
        steps=simple_evaluation_data.evaluator_steps,
        step_name="evaluator steps",
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
    for testset_ref, origin in simple_evaluation_data.testset_steps.items():
        testset_revision = await aretrieve_testset(
            testset_revision_id=testset_ref,
        )

        if not testset_revision or not testset_revision.id:
            testset_revision = await aretrieve_testset(
                testset_id=testset_ref,
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
    print("Evaluation running...")
    print(
        "────────────────────────────────────────────────────────────────────────────"
    )

    # Normalize testset_steps to revision ids (no JIT transfers in backend)
    if simple_evaluation_data.testset_steps and isinstance(
        simple_evaluation_data.testset_steps, dict
    ):
        normalized_testset_steps: Dict[str, Origin] = {}
        for testset_id_str, origin in simple_evaluation_data.testset_steps.items():
            try:
                testset_uuid = UUID(str(testset_id_str))
            except Exception:
                continue

            testset_revision = await aretrieve_testset(
                testset_revision_id=testset_uuid,
            )

            if not testset_revision or not testset_revision.id:
                # Fallback: treat as testset_id (latest revision)
                testset_revision = await aretrieve_testset(
                    testset_id=testset_uuid,
                )

            if testset_revision and testset_revision.id:
                normalized_testset_steps[str(testset_revision.id)] = origin

        simple_evaluation_data.testset_steps = normalized_testset_steps

    suffix = _timestamp_suffix()
    base_name = name.strip() if isinstance(name, str) else ""
    if not base_name:
        base_name = "SDK Eval"
    name = f"{base_name}{suffix}"

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

    async def create_scenario(run_id: UUID):
        return await aadd_scenario(run_id=run_id)

    async def refresh_metrics(run_id: UUID, scenario_id: Optional[UUID]):
        if scenario_id:
            return await acompute_metrics(run_id=run_id, scenario_id=scenario_id)
        return await acompute_metrics(run_id=run_id)

    result_logger = SdkResultLogger()
    trace_loader = SdkTraceLoader(max_retries=30, delay=1.0)

    for testset_revision in testset_revisions.values():
        if not testset_revision.data or not testset_revision.data.testcases:
            continue

        testcases = testset_revision.data.testcases
        input_step_key = "testset-" + testset_revision.slug  # type: ignore

        print(
            f"{UNICODE['next']}"
            f"{UNICODE['here']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            f"{UNICODE['skip']}"
            f" testset_id={str(testset_revision.testset_id)}",
        )

        steps = [
            EvaluationStep(
                key=input_step_key,
                type="input",
                origin="custom",
                references={
                    "testset": Reference(id=testset_revision.testset_id),
                    "testset_variant": Reference(
                        id=testset_revision.testset_variant_id
                    ),
                    "testset_revision": Reference(
                        id=testset_revision.id,
                        slug=testset_revision.slug,
                        version=testset_revision.version,
                    ),
                },
            )
        ]
        runners: Dict[str, Any] = {}
        revisions: Dict[str, Any] = {}

        for application_revision in application_revisions.values():
            if not application_revision or not application_revision.data:
                print("Missing or invalid application revision")
                if application_revision:
                    print(application_revision.model_dump(exclude_none=True))
                continue

            application_step_key = "application-" + application_revision.slug  # type: ignore
            steps.append(
                EvaluationStep(
                    key=application_step_key,
                    type="invocation",
                    origin="auto",
                    references={
                        "application": Reference(
                            id=application_revision.application_id
                        ),
                        "application_variant": Reference(
                            id=application_revision.application_variant_id,
                        ),
                        "application_revision": Reference(
                            id=application_revision.id,
                            slug=application_revision.slug,
                            version=application_revision.version,
                        ),
                    },
                )
            )
            runners[application_step_key] = SdkLocalApplicationRunner()
            revisions[application_step_key] = application_revision

        for (
            evaluator_revision_id,
            origin,
        ) in simple_evaluation_data.evaluator_steps.items():
            evaluator_revision = evaluator_revisions.get(
                evaluator_revision_id
            ) or evaluator_revisions.get(UUID(str(evaluator_revision_id)))
            if not evaluator_revision or not evaluator_revision.data:
                print("Missing or invalid evaluator revision")
                if evaluator_revision:
                    print(evaluator_revision.model_dump(exclude_none=True))
                continue

            evaluator_step_key = "evaluator-" + evaluator_revision.slug  # type: ignore
            steps.append(
                EvaluationStep(
                    key=evaluator_step_key,
                    type="annotation",
                    origin=origin,
                    references={
                        "evaluator": Reference(id=evaluator_revision.evaluator_id),
                        "evaluator_variant": Reference(
                            id=evaluator_revision.evaluator_variant_id,
                        ),
                        "evaluator_revision": Reference(
                            id=evaluator_revision.id,
                            slug=evaluator_revision.slug,
                            version=evaluator_revision.version,
                        ),
                    },
                )
            )
            if origin == "auto":
                runners[evaluator_step_key] = SdkLocalEvaluatorRunner()
                revisions[evaluator_step_key] = evaluator_revision

        source_items = []
        for testcase in testcases:
            inputs = dict(testcase.data or {})
            inputs.pop("testcase_dedup_id", None)
            source_items.append(
                ResolvedSourceItem(
                    kind="testcase",
                    step_key=input_step_key,
                    references={
                        "testcase": Reference(id=testcase.id),
                        "testset": Reference(id=testset_revision.testset_id),
                        "testset_variant": Reference(
                            id=testset_revision.testset_variant_id,
                        ),
                        "testset_revision": Reference(
                            id=testset_revision.id,
                            slug=testset_revision.slug,
                            version=testset_revision.version,
                        ),
                    },
                    testcase_id=testcase.id,
                    testcase=testcase.model_dump(mode="json", exclude_none=True),
                    inputs=inputs,
                )
            )

        processed = await process_evaluation_source_slice(
            run_id=run.id,
            source_items=source_items,
            steps=steps,
            repeats=simple_evaluation_data.repeats,
            create_scenario=create_scenario,
            result_logger=result_logger,
            refresh_metrics=refresh_metrics,
            runners=runners,
            revisions=revisions,
            trace_loader=trace_loader,
        )
        scenarios.extend(
            {
                "scenario": item.scenario,
                "results": item.results,
                "metrics": item.metrics,
            }
            for item in processed
        )

    if len(scenarios) > 0:
        metrics = await acompute_metrics(run_id=run.id)

    run = await aclose_run(
        run_id=run.id,
    )

    run_url = await aget_url(run_id=run.id)

    print(
        "────────────────────────────────────────────────────────────────────────────"
    )
    print("Evaluation finished.")
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
