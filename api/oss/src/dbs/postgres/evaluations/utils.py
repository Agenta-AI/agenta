from typing import Dict, Optional, List, Any, Union

from oss.src.core.evaluations.types import (
    EvaluationRunFlags,
    #
    EvaluationRun,
    EvaluationRunEdit,
    EvaluationRunQuery,
)


def _make_run_references(
    run: Optional[Union[EvaluationRun, EvaluationRunEdit]] = None,
) -> Optional[List[Any]]:
    references = None

    if not run or not run.data or not run.data.steps:
        return references

    _references: Dict[str, Any] = dict()

    for _step in run.data.steps:
        if not _step.references:
            continue

        for key, reference in _step.references.items():
            _key = getattr(reference, "id", None) or key
            _references[_key] = reference.model_dump(
                mode="json",
                exclude_none=True,
            ) | {"key": str(key)}

    references = list(_references.values()) or None

    return references


def create_run_references(
    run: Optional[EvaluationRun] = None,
) -> Optional[List[Any]]:
    return _make_run_references(run)


def edit_run_references(
    run: Optional[EvaluationRunEdit] = None,
) -> Optional[List[Any]]:
    return _make_run_references(run)


def query_run_references(
    run: Optional[EvaluationRunQuery] = None,
) -> Optional[List[Any]]:
    references = None

    if not run or not run.references:
        return references

    _references: Dict[str, Any] = dict()

    for references in run.references:
        for key, reference in references.items():
            _key = getattr(reference, "id", None) or key
            _references[_key] = reference.model_dump(
                mode="json",
                exclude_none=True,
            )  # | {"key": str(key)}

    references = list(_references.values()) or None

    return references


def _make_run_flags(
    run: Optional[Union[EvaluationRun, EvaluationRunEdit]] = None,
) -> Optional[EvaluationRunFlags]:
    flags = EvaluationRunFlags()

    if not run or not run.data or not run.data.steps:
        return flags

    flags = run.flags or EvaluationRunFlags()

    flags.has_queries = False
    flags.has_testsets = False
    flags.has_evaluators = False
    #
    flags.has_custom = False
    flags.has_human = False
    flags.has_auto = False

    for _step in run.data.steps:
        if _step.type == "input":
            _references = _step.references or dict()

            for _key in _references.keys():
                if "query" in str(_key).lower():
                    flags.has_queries = True

                if "testset" in str(_key).lower():
                    flags.has_testsets = True

        if _step.type == "annotation":
            flags.has_evaluators = True

            if _step.origin == "custom":
                flags.has_custom = True

            if _step.origin == "human":
                flags.has_human = True

            if _step.origin == "auto":
                flags.has_auto = True

    return flags


def create_run_flags(
    run: Optional[EvaluationRun] = None,
) -> Optional[EvaluationRunFlags]:
    return _make_run_flags(run)


def edit_run_flags(
    run: Optional[EvaluationRunEdit] = None,
) -> Optional[EvaluationRunFlags]:
    return _make_run_flags(run)
