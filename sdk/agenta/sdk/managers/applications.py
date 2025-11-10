from typing import Dict, Any, Callable, Optional
from uuid import uuid4, UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.decorators.running import auto_workflow, is_workflow
from agenta.sdk.models.workflows import (
    ApplicationRevision,
    #
    ApplicationRevisionResponse,
    #
    LegacyApplicationFlags,
    LegacyApplicationData,
    LegacyApplicationCreate,
    LegacyApplicationEdit,
    #
    LegacyApplicationResponse,
    #
    Reference,
)

from agenta.sdk.utils.references import get_slug_from_name_and_id


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
        endpoint=f"/preview/legacy/applications/revisions/retrieve",
        json=payload,
    )
    response.raise_for_status()

    application_revision_response = ApplicationRevisionResponse(**response.json())

    application_revision = application_revision_response.application_revision

    # print(" --- application_revision:", application_revision)

    return application_revision


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

        legacy_application_flags = LegacyApplicationFlags(**req.flags)

        legacy_application_data = LegacyApplicationData(
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
        print("[ERROR]: Failed to prepare application:", e)
        return None

    # print("Retrieve response:", retrieve_response)

    if retrieve_response and retrieve_response.id and retrieve_response.application_id:
        application_id = retrieve_response.application_id
        # print(" --- Updating application...", application_id)
        application_edit_request = LegacyApplicationEdit(
            id=application_id,
            #
            name=name,
            description=description,
            #
            flags=legacy_application_flags,
            #
            data=legacy_application_data,
        )

        # print(" --- application_edit_request:", application_edit_request)

        response = authed_api()(
            method="PUT",
            endpoint=f"/preview/legacy/applications/{application_id}",
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
            print("[ERROR]: Failed to update application:", e)
            return None

    else:
        # print(" --- Creating application...")
        application_create_request = LegacyApplicationCreate(
            slug=application_slug or uuid4().hex[-12:],
            #
            name=name,
            description=description,
            #
            flags=legacy_application_flags,
            #
            data=legacy_application_data,
        )

        # print(" --- application_create_request:", application_create_request)

        response = authed_api()(
            method="POST",
            endpoint="/preview/legacy/applications/",
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
            print("[ERROR]: Failed to create application:", e)
            return None

    application_response = LegacyApplicationResponse(**response.json())

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
