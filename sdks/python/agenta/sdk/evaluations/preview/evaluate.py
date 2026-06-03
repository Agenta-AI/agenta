from typing import Dict, List, Any, Union, Optional
from uuid import UUID
from copy import deepcopy
from datetime import datetime

from pydantic import BaseModel

from agenta.sdk.models.evaluations import (
    Origin,
    Target,
    SimpleEvaluationData,
)

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
    RunData,
    acreate as acreate_run,
    aclose as aclose_run,
    aurl as aget_url,
)
from agenta.sdk.evaluations.scenarios import (
    aadd as aadd_scenarios,
)
from agenta.sdk.evaluations.results import (
    apopulate as apopulate_slice,
)
from agenta.sdk.evaluations.metrics import (
    arefresh_slice,
    aquery_global as aquery_metrics,
)
from agenta.sdk.evaluations.runtime.processor import process_sources
from agenta.sdk.evaluations.runtime.executor import AsyncioEvaluationTaskRunner
from agenta.sdk.evaluations.runtime.adapters import (
    SDKWorkflowRunner,
)
from agenta.sdk.evaluations.preview.utils import afetch_trace


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


async def _resolve_testset_steps_to_revisions(
    testset_steps: Any,
) -> Dict[str, Origin]:
    """Pin each testset step key to a concrete revision id.

    A normalized testset step is `{id: origin}`, but `id` may be a testset id or
    a revision id. Resolve each: try it as a revision id, fall back to a testset
    id (latest revision). The backend persists these step refs verbatim and does
    no JIT resolution, so this must happen before the run is created.
    """
    if not testset_steps or not isinstance(testset_steps, dict):
        return testset_steps

    resolved: Dict[str, Origin] = {}
    for testset_id_str, origin in testset_steps.items():
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
            resolved[str(testset_revision.id)] = origin

    return resolved


async def _resolve_entities(
    simple_evaluation_data: SimpleEvaluationData,
) -> SimpleEvaluationData:
    """Resolve a parsed draft into a revision-pinned SimpleEvaluationData.

    The draft's `*_steps` arrive loose (a `Target`: revision ids, entity ids,
    callables, or inline testcase data). This is THE phase that turns each into
    a `{revision_id: origin}` dict — its postcondition is the invariant the rest
    of the pipeline relies on: every step map is keyed by a concrete revision id.

    Two mechanisms get there:
      - mint: callable -> revision (`aupsert_*`), inline data -> testset revision
        (`acreate_testset`); these return revision ids directly;
      - disambiguate: a passed testset UUID may be a testset id OR a revision id,
        so testset steps are pinned to revision ids here (no JIT resolution in
        the backend, which persists these step refs verbatim on the run).
    """
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

    # Pin testset steps to revision ids. A passed UUID may be a testset id or a
    # revision id; the backend does no JIT resolution and persists these step
    # refs verbatim on the run, so disambiguate to revision ids here. (Apps and
    # evaluators already resolve to revision ids above, via id or upsert.)
    simple_evaluation_data.testset_steps = await _resolve_testset_steps_to_revisions(
        simple_evaluation_data.testset_steps
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


def _timestamp_suffix():
    suffix = datetime.now().strftime("%y-%m-%d · %H:%M")
    return f" [{suffix}]"


async def _prepare_run_data(
    *,
    name: Optional[str],
    description: Optional[str],
    testsets: Optional[Target],
    applications: Optional[Target],
    evaluators: Optional[Target],
    repeats: Optional[int],
    specs: Optional[Union[EvaluateSpecs, Dict[str, Any]]],
) -> RunData:
    """Turn the raw `evaluate()` kwargs into the `RunData` for `acreate_run`.

    The full input phase:
      1. parse — pack the loose kwargs into a draft (`*_steps` still a `Target`:
         ids, callables, or inline data);
      2. resolve — mint + disambiguate every step to a revision id, so the
         revision-pinned invariant holds before the run is created;
      3. assemble — pair the resolved step maps with the timestamped run name
         (defaulting to "SDK Eval"), description, and repeats.
    """
    draft = await _parse_evaluate_kwargs(
        testsets=testsets,
        applications=applications,
        evaluators=evaluators,
        repeats=repeats,
        specs=specs,
    )

    simple_evaluation_data = await _resolve_entities(
        simple_evaluation_data=draft,
    )

    base_name = name.strip() if isinstance(name, str) else ""
    if not base_name:
        base_name = "SDK Eval"

    return RunData(
        name=f"{base_name}{_timestamp_suffix()}",
        description=description,
        #
        testset_steps=simple_evaluation_data.testset_steps,
        application_steps=simple_evaluation_data.application_steps,
        evaluator_steps=simple_evaluation_data.evaluator_steps,
        #
        repeats=simple_evaluation_data.repeats,
    )


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
    run_data = await _prepare_run_data(
        name=name,
        description=description,
        #
        testsets=testsets,
        applications=applications,
        evaluators=evaluators,
        #
        repeats=repeats,
        #
        specs=specs,
    )

    print()
    print(
        "────────────────────────────────────────────────────────────────────────────"
    )
    print("Evaluation running...")
    print(
        "────────────────────────────────────────────────────────────────────────────"
    )

    run = await acreate_run(
        name=run_data.name,
        description=run_data.description,
        #
        testset_steps=run_data.testset_steps,
        application_steps=run_data.application_steps,
        evaluator_steps=run_data.evaluator_steps,
        #
        repeats=run_data.repeats,
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

    runner = AsyncioEvaluationTaskRunner(
        retrieve_testset=aretrieve_testset,
        retrieve_application=aretrieve_application,
        retrieve_evaluator=aretrieve_evaluator,
        #
        fetch_trace=afetch_trace,
        #
        add_scenarios=aadd_scenarios,
        #
        populate_slice=apopulate_slice,
        refresh_slice=arefresh_slice,
        #
        process_sources=process_sources,
        #
        workflow_runner=SDKWorkflowRunner(),
    )

    scenarios = await runner.process_run_locally(
        run_id=run.id,
        run_data=run_data,
    )

    if not scenarios:
        log.warning(
            "[EVAL] evaluation produced no scenarios; check testset",
            run_id=str(run.id),
        )

    run = await aclose_run(
        run_id=run.id,
    )

    # Global metrics only
    metrics = await aquery_metrics(
        run_id=run.id,
    )

    run_url = await aget_url(
        run_id=run.id,
    )

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
