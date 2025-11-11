from typing import List, Dict, Any, Callable
from uuid import uuid4, UUID

from definitions import (
    Testcase,
    TestsetRevisionData,
    TestsetRevision,
    ApplicationRevision,
    ApplicationRevisionData,
    EvaluatorRevision,
    WorkflowRevisionData,
)

from services import register_handler

TESTSET_REVISION_ID = uuid4()
TESTSET_REVISION = TestsetRevision(
    id=TESTSET_REVISION_ID,
    slug=str(TESTSET_REVISION_ID)[-12:],
    data=TestsetRevisionData(
        testcases=[
            Testcase(
                id=uuid4(),
                data={"country": "Germany", "capital": "Berlin"},
            ),
            Testcase(
                id=uuid4(),
                data={"country": "France", "capital": "Paris"},
            ),
        ]
    ),
)

APPLICATION_REVISION_ID = uuid4()
APPLICATION_REVISION = ApplicationRevision(
    id=APPLICATION_REVISION_ID,
    slug=str(APPLICATION_REVISION_ID)[-12:],
    version="0",
    data=ApplicationRevisionData(),
)

EVALUATOR_REVISION_ID = uuid4()
EVALUATOR_REVISION = EvaluatorRevision(
    id=EVALUATOR_REVISION_ID,
    slug=str(EVALUATOR_REVISION_ID)[-12:],
    version="0",
    data=WorkflowRevisionData(),
)

MOCK_URI = None


async def upsert_testset(
    testcases_data: List[Dict[str, Any]],
) -> UUID:
    return TESTSET_REVISION_ID


async def retrieve_testset(
    testset_revision_id: UUID,
) -> TestsetRevision:
    return TESTSET_REVISION


async def upsert_application(
    application_handler: Callable,
) -> UUID:
    global MOCK_URI
    MOCK_URI = register_handler(application_handler)
    return APPLICATION_REVISION_ID


async def retrieve_application(
    application_revision_id: UUID,
) -> ApplicationRevision:
    application_revision = APPLICATION_REVISION
    application_revision.data.uri = MOCK_URI
    return application_revision


async def upsert_evaluator(
    evaluator_handler: Callable,
) -> UUID:
    return EVALUATOR_REVISION_ID


async def retrieve_evaluator(
    evaluator_revision_id: UUID,
) -> EvaluatorRevision:
    return EVALUATOR_REVISION
