import asyncio
from typing import List, Dict, Any, Callable, Optional
from uuid import uuid4, UUID

from definitions import (
    Testcase,
    TestsetRevisionData,
    TestsetRevision,
    ApplicationRevision,
    EvaluatorRevision,
    #
    SimpleTestsetCreate,
    SimpleTestsetEdit,
    #
    SimpleTestsetResponse,
    TestsetRevisionResponse,
    #
    Evaluator,
    #
    SimpleEvaluatorData,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    #
    EvaluatorRevisionData,
    SimpleEvaluatorResponse,
    EvaluatorRevisionResponse,
    #
    ApplicationRevisionResponse,
    #
    LegacyApplicationData,
    LegacyApplicationCreate,
    LegacyApplicationEdit,
    #
    LegacyApplicationResponse,
)
from services import (
    REGISTRY,
    register_handler,
    retrieve_handler,
)

from client import authed_api


client = authed_api()

APPLICATION_REVISION_ID = uuid4()
APPLICATION_REVISION = ApplicationRevision(
    id=APPLICATION_REVISION_ID,
    slug=str(APPLICATION_REVISION_ID)[-12:],
    version="0",
)

EVALUATOR_REVISION_ID = uuid4()
EVALUATOR_REVISION = EvaluatorRevision(
    id=EVALUATOR_REVISION_ID,
    slug=str(EVALUATOR_REVISION_ID)[-12:],
    version="0",
)


async def _retrieve_testset(
    testset_id: Optional[UUID] = None,
    testset_revision_id: Optional[UUID] = None,
) -> Optional[TestsetRevision]:
    response = client(
        method="POST",
        endpoint="/preview/testsets/revisions/retrieve",
        params={
            "testset_id": testset_id,
            "testset_revision_id": testset_revision_id,
        },
    )

    response.raise_for_status()

    testset_revision_response = TestsetRevisionResponse(**response.json())

    testset_revision = testset_revision_response.testset_revision

    return testset_revision


async def retrieve_testset(
    testset_revision_id: Optional[UUID] = None,
) -> Optional[TestsetRevision]:
    response = await _retrieve_testset(
        testset_revision_id=testset_revision_id,
    )

    return response


async def upsert_testset(
    testcases_data: List[Dict[str, Any]],
    #
    testset_revision_id: Optional[UUID] = None,
    #
    testset_id: Optional[UUID] = None,
    testset_name: Optional[str] = None,
    testset_description: Optional[str] = None,
) -> Optional[UUID]:
    testset_revision_data = TestsetRevisionData(
        testcases=[
            Testcase(
                data=testcase_data,
            )
            for testcase_data in testcases_data
        ]
    )

    retrieve_response = None

    if testset_revision_id:
        retrieve_response = await _retrieve_testset(
            testset_revision_id=testset_revision_id,
        )
    elif testset_id:
        retrieve_response = await _retrieve_testset(
            testset_id=testset_id,
        )

    if retrieve_response and retrieve_response.id:
        testset_edit_request = SimpleTestsetEdit(
            id=testset_id,
            name=testset_name,
            description=testset_description,
            data=testset_revision_data,
        )

        response = client(
            method="PUT",
            endpoint=f"/preview/simple/testsets/{testset_id}",
            json={
                "testset": testset_edit_request.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            },
        )

        try:
            response.raise_for_status()
        except Exception as e:
            print(f"[ERROR]: Failed to update testset: {e}")
            return None

    else:
        testset_create_request = SimpleTestsetCreate(
            name=testset_name,
            description=testset_description,
            slug=uuid4().hex,
            data=testset_revision_data,
        )

        response = client(
            method="POST",
            endpoint="/preview/simple/testsets/",
            json={
                "testset": testset_create_request.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            },
        )

        try:
            response.raise_for_status()
        except Exception as e:
            print(f"[ERROR]: Failed to create testset: {e}")
            return None

    testset_response = SimpleTestsetResponse(**response.json())

    testset = testset_response.testset

    if not testset or not testset.id:
        return None

    testset_revision = await _retrieve_testset(
        testset_id=testset.id,
    )

    if not testset_revision or not testset_revision.id:
        return None

    return testset_revision.id


async def _retrieve_application(
    application_id: Optional[UUID] = None,
    application_revision_id: Optional[UUID] = None,
) -> Optional[ApplicationRevision]:
    response = client(
        method="POST",
        endpoint=f"/preview/legacy/applications/revisions/retrieve",
        params={
            "application_id": application_id,
            "application_revision_id": application_revision_id,
        },
    )
    response.raise_for_status()

    application_revision_response = ApplicationRevisionResponse(**response.json())

    application_revision = application_revision_response.application_revision

    if not application_revision or not application_revision.id:
        return None

    if not application_revision.data or not application_revision.data.uri:
        return None

    application_revision.data.handler = retrieve_handler(application_revision.data.uri)

    return application_revision


async def retrieve_application(
    application_revision_id: Optional[UUID] = None,
) -> Optional[ApplicationRevision]:
    response = await _retrieve_application(
        application_revision_id=application_revision_id,
    )

    return response


async def upsert_application(
    application_handler: Callable,
    application_script: Optional[str] = None,
    application_parameters: Optional[Dict[str, Any]] = None,
    #
    application_revision_id: Optional[UUID] = None,
    #
    application_id: Optional[UUID] = None,
    application_name: Optional[str] = None,
    application_description: Optional[str] = None,
) -> Optional[UUID]:
    legacy_application_data = LegacyApplicationData(
        uri=register_handler(application_handler),
        script=application_script,
        parameters=application_parameters,
    )

    retrieve_response = None

    if application_revision_id:
        retrieve_response = await _retrieve_application(
            application_revision_id=application_revision_id,
        )
    elif application_id:
        retrieve_response = await _retrieve_application(
            application_id=application_id,
        )

    if retrieve_response and retrieve_response.id:
        application_edit_request = LegacyApplicationEdit(
            id=application_id,
            name=application_name,
            description=application_description,
            data=legacy_application_data,
        )

        response = client(
            method="PUT",
            endpoint=f"/preview/legacy/applications/{application_id}",
            json={
                "application": application_edit_request.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            },
        )

        try:
            response.raise_for_status()
        except Exception as e:
            print("[ERROR]: Failed to update application:", e)
            return None

    else:
        application_create_request = LegacyApplicationCreate(
            name=application_name,
            description=application_description,
            slug=uuid4().hex,
            data=legacy_application_data,
        )

        response = client(
            method="POST",
            endpoint="/preview/legacy/applications/",
            json={
                "application": application_create_request.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            },
        )

        try:
            response.raise_for_status()
        except Exception as e:
            print("[ERROR]: Failed to create application:", e)
            return None

    application_response = LegacyApplicationResponse(**response.json())

    application = application_response.application

    if not application or not application.id:
        return None

    application_revision = await _retrieve_application(
        application_id=application.id,
    )

    if not application_revision or not application_revision.id:
        return None

    return application_revision.id


async def _retrieve_evaluator(
    evaluator_id: Optional[UUID] = None,
    evaluator_revision_id: Optional[UUID] = None,
) -> Optional[EvaluatorRevision]:
    response = client(
        method="POST",
        endpoint=f"/preview/evaluators/revisions/retrieve",
        params={
            "evaluator_id": evaluator_id,
            "evaluator_revision_id": evaluator_revision_id,
        },
    )
    response.raise_for_status()

    evaluator_revision_response = EvaluatorRevisionResponse(**response.json())

    evaluator_revision = evaluator_revision_response.evaluator_revision

    return evaluator_revision


async def retrieve_evaluator(
    evaluator_revision_id: Optional[UUID] = None,
) -> Optional[EvaluatorRevision]:
    response = await _retrieve_evaluator(
        evaluator_revision_id=evaluator_revision_id,
    )

    return response


async def upsert_evaluator(
    evaluator_handler: Callable,
    evaluator_script: Optional[str] = None,
    evaluator_parameters: Optional[Dict[str, Any]] = None,
    #
    evaluator_revision_id: Optional[UUID] = None,
    #
    evaluator_id: Optional[UUID] = None,
    evaluator_name: Optional[str] = None,
    evaluator_description: Optional[str] = None,
) -> Optional[UUID]:
    simple_evaluator_data = SimpleEvaluatorData(
        uri=register_handler(evaluator_handler),
        script=evaluator_script,
        parameters=evaluator_parameters,
    )

    retrieve_response = None

    if evaluator_revision_id:
        retrieve_response = await _retrieve_evaluator(
            evaluator_revision_id=evaluator_revision_id,
        )
    elif evaluator_id:
        retrieve_response = await _retrieve_evaluator(
            evaluator_id=evaluator_id,
        )

    if retrieve_response and retrieve_response.id:
        evaluator_edit_request = SimpleEvaluatorEdit(
            id=evaluator_id,
            name=evaluator_name,
            description=evaluator_description,
            data=simple_evaluator_data,
        )

        response = client(
            method="PUT",
            endpoint=f"/preview/simple/evaluators/{evaluator_id}",
            json={
                "evaluator": evaluator_edit_request.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            },
        )

        try:
            response.raise_for_status()
        except Exception as e:
            print("[ERROR]: Failed to update evaluator:", e)
            return None

    else:
        evaluator_create_request = SimpleEvaluatorCreate(
            name=evaluator_name,
            description=evaluator_description,
            slug=uuid4().hex,
            data=simple_evaluator_data,
        )

        response = client(
            method="POST",
            endpoint="/preview/simple/evaluators/",
            json={
                "evaluator": evaluator_create_request.model_dump(
                    mode="json",
                    exclude_none=True,
                )
            },
        )

        try:
            response.raise_for_status()
        except Exception as e:
            print("[ERROR]: Failed to create evaluator:", e)
            return None

    evaluator_response = SimpleEvaluatorResponse(**response.json())

    evaluator = evaluator_response.evaluator

    if not evaluator or not evaluator.id:
        return None

    evaluator_revision = await _retrieve_evaluator(
        evaluator_id=evaluator.id,
    )

    if not evaluator_revision or not evaluator_revision.id:
        return None

    return evaluator_revision.id
