from typing import Dict, Any, Callable, Optional
from uuid import uuid4, UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.decorators.running import auto_workflow, is_workflow
from agenta.sdk.models.workflows import (
    ApplicationRevision,
    #
    ApplicationRevisionResponse,
    #
    SimpleApplication,
    SimpleApplicationFlags,
    SimpleApplicationData,
    SimpleApplicationCreate,
    SimpleApplicationEdit,
    #
    SimpleApplicationResponse,
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


async def _retrieve_application(
    application_id: Optional[UUID] = None,
    application_slug: Optional[str] = None,
    application_revision_id: Optional[UUID] = None,
    application_revision_slug: Optional[str] = None,
) -> Optional[ApplicationRevision]:
    payload = {
        "application_ref": (
            {
                "id": str(application_id) if application_id else None,
                "slug": str(application_slug),
            }
            if application_id or application_slug
            else None
        ),
        "application_revision_ref": (
            {
                "id": (
                    str(application_revision_id) if application_revision_id else None
                ),
                "slug": application_revision_slug,
            }
            if application_revision_id or application_revision_slug
            else None
        ),
    }

    # print(" --- payload:", payload)

    response = authed_api()(
        method="POST",
        endpoint="/preview/applications/revisions/retrieve",
        json=payload,
    )
    response.raise_for_status()

    application_revision_response = ApplicationRevisionResponse(**response.json())

    application_revision = application_revision_response.application_revision

    # print(" --- application_revision:", application_revision)

    return application_revision


async def _fetch_simple_application(
    *,
    application_id: UUID,
) -> Optional[SimpleApplication]:
    response = authed_api()(
        method="GET",
        endpoint=f"/preview/simple/applications/{application_id}",
    )

    if response.status_code == 404:
        return None

    try:
        response.raise_for_status()
    except Exception as e:
        detail = _response_detail(response)
        message = (
            f"Failed to fetch application '{application_id}' before update: {detail}"
        )
        print("[ERROR]:", message)
        raise ValueError(message) from e

    simple_application_response = SimpleApplicationResponse(**response.json())

    return simple_application_response.application


async def aretrieve(
    application_revision_id: Optional[UUID] = None,
) -> Optional[ApplicationRevision]:
    # print("\n--------- RETRIEVE APPLICATION")

    response = await _retrieve_application(
        application_revision_id=application_revision_id,
    )

    return response


async def aupsert(
    *,
    application_id: Optional[UUID] = None,
    application_slug: Optional[str] = None,
    application_revision_id: Optional[UUID] = None,
    application_revision_slug: Optional[str] = None,
    #
    handler: Callable,
    script: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[UUID]:
    """Upsert a simple application and return its revision ID.

    Returns:
        The application revision UUID, or None when the API responds without
        a usable application/revision object.

    Raises:
        ValueError: If preparation fails or API create/update calls fail.
    """
    # print("\n---------   UPSERT APPLICATION")
    try:
        if not is_workflow(handler):
            application_workflow = auto_workflow(
                handler,
                #
                script=script,
                parameters=parameters,
                #
                name=name,
                description=description,
            )
        else:
            application_workflow = handler

        req = await application_workflow.inspect()

        simple_application_flags = SimpleApplicationFlags(**req.flags)

        simple_application_data = SimpleApplicationData(
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

        # print(
        #     " ---:", legacy_application_data.model_dump(mode="json", exclude_none=True)
        # )

        retrieve_response = None

        if req.references is not None:
            _application_revision_ref = req.references.get("application_revision", {})
            if isinstance(_application_revision_ref, Reference):
                _application_revision_ref = _application_revision_ref.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            if not isinstance(_application_revision_ref, dict):
                _application_revision_ref = {}
            _application_revision_id = _application_revision_ref.get("id")
            _application_revision_slug = _application_revision_ref.get("slug")

            application_revision_id = (
                application_revision_id or _application_revision_id
            )
            application_revision_slug = (
                application_revision_slug or _application_revision_slug
            )

            _application_ref = req.references.get("application", {})
            if isinstance(_application_ref, Reference):
                _application_ref = _application_ref.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            if not isinstance(_application_ref, dict):
                _application_ref = {}
            _application_id = _application_ref.get("id")
            _application_slug = _application_ref.get("slug")

            application_id = application_id or _application_id
            application_slug = application_slug or _application_slug

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

        application_slug = (
            application_slug
            or get_slug_from_name_and_id(
                name=name,
                id=application_id or uuid4(),
            )
            if name
            else uuid4().hex[-12:]
        )

        # print(
        #     application_id,
        #     application_slug,
        #     application_revision_id,
        #     application_revision_slug,
        # )

        if application_revision_id or application_revision_slug:
            retrieve_response = await _retrieve_application(
                application_revision_id=application_revision_id,
                application_revision_slug=application_revision_slug,
            )
        elif application_id or application_slug:
            retrieve_response = await _retrieve_application(
                application_id=application_id,
                application_slug=application_slug,
            )

    except Exception as e:
        message = f"Failed to prepare application: {e}"
        print("[ERROR]:", message)
        raise ValueError(message) from e

    # print("Retrieve response:", retrieve_response)

    if retrieve_response and retrieve_response.id and retrieve_response.application_id:
        existing_application_name = None
        try:
            with_name = await _fetch_simple_application(
                application_id=retrieve_response.application_id
            )
        except ValueError as e:
            print(
                "[WARN]: Failed to fetch existing application for name preservation; "
                f"continuing without it: {e}"
            )
            with_name = None
        if with_name:
            existing_application_name = with_name.name

        # TEMPORARY: API simple application edit currently rejects renaming.
        # Preserve the existing stored name when updating by slug/id so evaluate()
        # can keep syncing configuration/data without triggering rename failures.
        if (
            existing_application_name
            and name is not None
            and name != existing_application_name
        ):
            print(
                "[INFO]: Renaming applications is temporarily disabled. "
                f"Using existing application name '{existing_application_name}'."
            )
            name = existing_application_name
        elif existing_application_name and name is None:
            name = existing_application_name

        application_id = retrieve_response.application_id
        # print(" --- Updating application...", application_id)
        application_edit_request = SimpleApplicationEdit(
            id=application_id,
            #
            name=name,
            description=description,
            #
            flags=simple_application_flags,
            #
            data=simple_application_data,
        )

        # print(" --- application_edit_request:", application_edit_request)

        response = authed_api()(
            method="PUT",
            endpoint=f"/preview/simple/applications/{application_id}",
            json={
                "application": application_edit_request.model_dump(
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
            message = f"Failed to update application: {detail}"
            print("[ERROR]:", message)
            raise ValueError(message) from e

    else:
        # print(" --- Creating application...")
        application_create_request = SimpleApplicationCreate(
            slug=application_slug or uuid4().hex[-12:],
            #
            name=name,
            description=description,
            #
            flags=simple_application_flags,
            #
            data=simple_application_data,
        )

        # print(" --- application_create_request:", application_create_request)

        response = authed_api()(
            method="POST",
            endpoint="/preview/simple/applications/",
            json={
                "application": application_create_request.model_dump(
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
            message = f"Failed to create application: {detail}"
            print("[ERROR]:", message)
            raise ValueError(message) from e

    application_response = SimpleApplicationResponse(**response.json())

    application = application_response.application

    if not application or not application.id:
        return None

    # print(" --- application:", application)

    application_revision = await _retrieve_application(
        application_id=application.id,
    )

    if not application_revision or not application_revision.id:
        return None

    # print(application_revision, "----------")

    return application_revision.id
