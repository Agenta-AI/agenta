from typing import Dict, Any, Callable, Optional
from uuid import uuid4, UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.decorators.running import auto_workflow, is_workflow
from agenta.sdk.models.workflows import (
    EvaluatorRevision,
    #
    EvaluatorRevisionResponse,
    #
    SimpleEvaluator,
    SimpleEvaluatorFlags,
    SimpleEvaluatorData,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    #
    SimpleEvaluatorResponse,
    #
    Reference,
)

from agenta.sdk.utils.references import get_slug_from_name_and_id


def _response_detail(response) -> str:
    try:
        data = response.json()
    except Exception:
        return response.text

    if isinstance(data, dict) and "detail" in data:
        detail = data.get("detail")
        if isinstance(detail, str):
            return detail
        return str(detail)

    return str(data)


async def _retrieve_evaluator(
    evaluator_id: Optional[UUID] = None,
    evaluator_slug: Optional[str] = None,
    evaluator_revision_id: Optional[UUID] = None,
    evaluator_revision_slug: Optional[str] = None,
) -> Optional[EvaluatorRevision]:
    payload = {
        "evaluator_ref": (
            {
                "id": str(evaluator_id) if evaluator_id else None,
                "slug": str(evaluator_slug),
            }
            if evaluator_id or evaluator_slug
            else None
        ),
        "evaluator_revision_ref": (
            {
                "id": str(evaluator_revision_id) if evaluator_revision_id else None,
                "slug": evaluator_revision_slug,
            }
            if evaluator_revision_id or evaluator_revision_slug
            else None
        ),
    }

    # print(" --- payload:", payload)

    response = authed_api()(
        method="POST",
        endpoint="/preview/evaluators/revisions/retrieve",
        json=payload,
    )

    response.raise_for_status()

    evaluator_revision_response = EvaluatorRevisionResponse(**response.json())

    evaluator_revision = evaluator_revision_response.evaluator_revision

    # print(" --- evaluator_revision:", evaluator_revision)

    return evaluator_revision


async def _fetch_simple_evaluator(
    *,
    evaluator_id: UUID,
) -> Optional[SimpleEvaluator]:
    response = authed_api()(
        method="GET",
        endpoint=f"/preview/simple/evaluators/{evaluator_id}",
    )

    if response.status_code == 404:
        return None

    try:
        response.raise_for_status()
    except Exception as e:
        detail = _response_detail(response)
        message = f"Failed to fetch evaluator '{evaluator_id}' before update: {detail}"
        print("[ERROR]:", message)
        raise ValueError(message) from e

    simple_evaluator_response = SimpleEvaluatorResponse(**response.json())

    return simple_evaluator_response.evaluator


async def aretrieve(
    evaluator_revision_id: Optional[UUID] = None,
) -> Optional[EvaluatorRevision]:
    # print("\n--------- RETRIEVE EVALUATOR")
    response = await _retrieve_evaluator(
        evaluator_revision_id=evaluator_revision_id,
    )

    return response


async def aupsert(
    *,
    evaluator_id: Optional[UUID] = None,
    evaluator_slug: Optional[str] = None,
    evaluator_revision_id: Optional[UUID] = None,
    evaluator_revision_slug: Optional[str] = None,
    #
    handler: Callable,
    script: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[UUID]:
    """Upsert a simple evaluator and return its revision ID.

    Returns:
        The evaluator revision UUID, or None when the API responds without
        a usable evaluator/revision object.

    Raises:
        ValueError: If preparation fails or API fetch/create/update calls fail.
    """
    # print("\n---------   UPSERT EVALUATOR")
    try:
        if not is_workflow(handler):
            evaluator_workflow = auto_workflow(
                handler,
                #
                script=script,
                parameters=parameters,
                #
                name=name,
                description=description,
            )
        else:
            evaluator_workflow = handler

        req = await evaluator_workflow.inspect()

        legacy_application_flags = SimpleEvaluatorFlags(**req.flags)

        simple_evaluator_data = SimpleEvaluatorData(
            **(
                req.interface.model_dump(mode="json", exclude_none=True)
                if req and req.interface
                else {}
            ),
            **(
                req.configuration.model_dump(mode="json", exclude_none=True)
                if req and req.configuration
                else {}
            ),
        )
        # print(" ---:", simple_evaluator_data.model_dump(mode="json", exclude_none=True))

        retrieve_response = None

        if req.references is not None:
            _evaluator_revision_ref = req.references.get("evaluator_revision", {})
            if isinstance(_evaluator_revision_ref, Reference):
                _evaluator_revision_ref = _evaluator_revision_ref.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            if not isinstance(_evaluator_revision_ref, dict):
                _evaluator_revision_ref = {}

            _evaluator_revision_id = _evaluator_revision_ref.get("id")
            _evaluator_revision_slug = _evaluator_revision_ref.get("slug")

            evaluator_revision_id = evaluator_revision_id or _evaluator_revision_id
            evaluator_revision_slug = (
                evaluator_revision_slug or _evaluator_revision_slug
            )

            _evaluator_ref = req.references.get("evaluator", {})
            if isinstance(_evaluator_ref, Reference):
                _evaluator_ref = _evaluator_ref.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            if not isinstance(_evaluator_ref, dict):
                _evaluator_ref = {}

            _evaluator_id = _evaluator_ref.get("id")
            _evaluator_slug = _evaluator_ref.get("slug")

            evaluator_id = evaluator_id or _evaluator_id
            evaluator_slug = evaluator_slug or _evaluator_slug

            revision = req.data.revision if req and req.data else None
            if revision:
                name = name or revision.get("name")
                description = description or revision.get("description")

        name = (
            name or req.data.revision.get("name")
            if req and req.data and req.data.revision
            else None
        )

        description = (
            description or req.data.revision.get("description")
            if req and req.data and req.data.revision
            else None
        )

        evaluator_slug = (
            evaluator_slug
            or get_slug_from_name_and_id(
                name=name,
                id=evaluator_id or uuid4(),
            )
            if name
            else uuid4().hex[-12:]
        )

        # print(
        #     evaluator_id,
        #     evaluator_slug,
        #     evaluator_revision_id,
        #     evaluator_revision_slug,
        # )

        if evaluator_revision_id or evaluator_revision_slug:
            retrieve_response = await _retrieve_evaluator(
                evaluator_revision_id=evaluator_revision_id,
                evaluator_revision_slug=evaluator_revision_slug,
            )
        elif evaluator_id or evaluator_slug:
            retrieve_response = await _retrieve_evaluator(
                evaluator_id=evaluator_id,
                evaluator_slug=evaluator_slug,
            )

    except Exception as e:
        message = f"Failed to prepare evaluator: {e}"
        print("[ERROR]:", message)
        raise ValueError(message) from e

    # print("Retrieve response:", retrieve_response)

    if retrieve_response and retrieve_response.id and retrieve_response.evaluator_id:
        existing_evaluator_name = None
        with_name = await _fetch_simple_evaluator(
            evaluator_id=retrieve_response.evaluator_id
        )
        if with_name:
            existing_evaluator_name = with_name.name

        # TEMPORARY: API simple evaluator edit currently rejects renaming.
        # Preserve the existing stored name when updating by slug/id so evaluate()
        # can keep syncing configuration/data without triggering rename failures.
        if (
            existing_evaluator_name
            and name is not None
            and name != existing_evaluator_name
        ):
            print(
                "[INFO]: Renaming evaluators is temporarily disabled. "
                f"Using existing evaluator name '{existing_evaluator_name}'."
            )
            name = existing_evaluator_name
        elif existing_evaluator_name and name is None:
            name = existing_evaluator_name

        evaluator_id = retrieve_response.evaluator_id
        # print(" --- Updating evaluator...", evaluator_id)
        evaluator_edit_request = SimpleEvaluatorEdit(
            id=evaluator_id,
            #
            name=name,
            description=description,
            #
            flags=legacy_application_flags,
            #
            data=simple_evaluator_data,
        )

        # print(" --- evaluator_edit_request:", evaluator_edit_request)

        response = authed_api()(
            method="PUT",
            endpoint=f"/preview/simple/evaluators/{evaluator_id}",
            json={
                "evaluator": evaluator_edit_request.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            },
        )

        # print(" --- response:", response.status_code, response.text)

        try:
            response.raise_for_status()
        except Exception as e:
            detail = _response_detail(response)
            message = f"Failed to update evaluator: {detail}"
            print("[ERROR]:", message)
            raise ValueError(message) from e

    else:
        # print(" --- Creating evaluator...")
        evaluator_create_request = SimpleEvaluatorCreate(
            slug=evaluator_slug or uuid4().hex[-12:],
            #
            name=name,
            description=description,
            #
            flags=legacy_application_flags,
            #
            data=simple_evaluator_data,
        )

        # print(" --- evaluator_create_request:", evaluator_create_request)

        response = authed_api()(
            method="POST",
            endpoint="/preview/simple/evaluators/",
            json={
                "evaluator": evaluator_create_request.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            },
        )

        # print(" --- response:", response.status_code, response.text)

        try:
            response.raise_for_status()
        except Exception as e:
            detail = _response_detail(response)
            message = f"Failed to create evaluator: {detail}"
            print("[ERROR]:", message)
            raise ValueError(message) from e

    evaluator_response = SimpleEvaluatorResponse(**response.json())

    evaluator = evaluator_response.evaluator

    if not evaluator or not evaluator.id:
        return None

    # print(" --- evaluator:", evaluator)

    evaluator_revision = await _retrieve_evaluator(
        evaluator_id=evaluator.id,
    )

    if not evaluator_revision or not evaluator_revision.id:
        return None

    # print(evaluator_revision, "----------")

    return evaluator_revision.id
