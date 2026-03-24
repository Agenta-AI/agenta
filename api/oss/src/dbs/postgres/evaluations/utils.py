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
    *,
    base_flags: Optional[EvaluationRunFlags] = None,
) -> Optional[EvaluationRunFlags]:
    if not run:
        return base_flags.model_copy(deep=True) if base_flags else EvaluationRunFlags()

    flags = base_flags.model_copy(deep=True) if base_flags else EvaluationRunFlags()

    if run.flags:
        explicit_updates = {
            field_name: getattr(run.flags, field_name)
            for field_name in run.flags.model_fields_set
        }
        if explicit_updates:
            flags = flags.model_copy(update=explicit_updates)

    if not run.data or not run.data.steps:
        return flags

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

            if flags.is_queue and not _references:
                step_key = (_step.key or "").lower()

                if "query" in step_key:
                    flags.has_queries = True
                if "testset" in step_key:
                    flags.has_testsets = True

            for _key in _references.keys():
                step_key = str(_key).lower()

                if "query" in step_key:
                    flags.has_queries = True
                if "testset" in step_key:
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
    *,
    base_flags: Optional[EvaluationRunFlags] = None,
) -> Optional[EvaluationRunFlags]:
    return _make_run_flags(run, base_flags=base_flags)
