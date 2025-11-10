from typing import List, Dict, Any, Optional
from uuid import UUID

from agenta.sdk.utils.client import authed_api
from agenta.sdk.utils.references import get_slug_from_name_and_id
from agenta.sdk.models.testsets import (
    LegacyTestset,
    #
    Testcase,
    TestsetRevisionData,
    TestsetRevision,
    #
    TestsetRevisionResponse,
)


async def _create_legacy_testset(
    *,
    csvdata: List[Dict[str, Any]],
    name: str,
    testset_id: Optional[UUID] = None,
) -> Optional[TestsetRevision]:
    response = authed_api()(
        method="POST",
        endpoint="/testsets/",
        json={
            "testset_id": str(testset_id) if testset_id else None,
            "name": name,
            "csvdata": csvdata,
        },
    )

    if response.status_code != 200:
        print("Failed to create testset:", response.status_code, response.text)
        return None

    legacy_testset = LegacyTestset(**response.json())

    # print(" --- legacy_testset:", legacy_testset)

    if not legacy_testset.id or not legacy_testset.name:
        return None

    testset_revision = TestsetRevision(
        id=UUID(legacy_testset.id),
        slug=get_slug_from_name_and_id(
            name=legacy_testset.name,
            id=UUID(legacy_testset.id),
        ),
        name=legacy_testset.name,
        data=TestsetRevisionData(
            testcases=[
                Testcase(
                    data=testcase_data,
                    testset_id=UUID(legacy_testset.id),
                )
                for testcase_data in csvdata
            ]
        ),
    )

    # print(" --- testset_revision:", testset_revision)

    return testset_revision


async def _fetch_legacy_testset(
    testset_id: Optional[UUID] = None,
    #
    name: Optional[str] = None,
) -> Optional[TestsetRevision]:
    legacy_testset = None

    if testset_id:
        response = authed_api()(
            method="GET",
            endpoint=f"/testsets/{testset_id}",
        )

        if response.status_code != 200:
            if response.status_code != 404:
                print("Failed to fetch testset:", response.status_code, response.text)
            return None

        legacy_testset = LegacyTestset(**response.json())
    elif name:
        response = authed_api()(
            method="GET",
            endpoint="/testsets/",
            params={"name": name},
        )

        if response.status_code != 200:
            print("Failed to list testsets:", response.status_code, response.text)
            return None

        _testsets = response.json()

        for testset in _testsets:
            _id = testset.pop("_id", None)
            testset["id"] = _id

        legacy_testsets = [LegacyTestset(**testset) for testset in _testsets]

        if len(legacy_testsets) != 1:
            print("Expected exactly one testset with name:", name)
            return None

        legacy_testset = legacy_testsets[0]

    # print(" --- legacy_testset:", legacy_testset)

    if not legacy_testset.id or not legacy_testset.name:
        return None

    testset_revision = TestsetRevision(
        testset_id=UUID(legacy_testset.id),
        slug=get_slug_from_name_and_id(
            name=legacy_testset.name,
            id=UUID(legacy_testset.id),
        ),
        name=legacy_testset.name,
        data=(
            TestsetRevisionData(
                testcases=[
                    Testcase(
                        data=testcase_data,
                        testset_id=UUID(legacy_testset.id),
                    )
                    for testcase_data in legacy_testset.csvdata
                ]
            )
            if legacy_testset.csvdata
            else None
        ),
    )

    # print(" --- testset_revision:", testset_revision)

    return testset_revision


async def _edit_legacy_testset(
    *,
    testset_id: UUID,
    csvdata: List[Dict[str, Any]],
    name: Optional[str] = None,
) -> Optional[TestsetRevision]:
    response = authed_api()(
        method="PUT",
        endpoint=f"/testsets/{testset_id}",
        json={
            "name": name,
            "csvdata": csvdata,
        },
    )

    if response.status_code != 200:
        print("Failed to edit testset:", response.status_code, response.text)
        return None

    response = authed_api()(
        method="GET",
        endpoint=f"/testsets/{testset_id}",
    )

    legacy_testset = LegacyTestset(**response.json())

    # print(" --- legacy_testset:", legacy_testset)

    if not legacy_testset.id or not legacy_testset.name:
        return None

    testset_revision = TestsetRevision(
        id=UUID(legacy_testset.id),
        slug=get_slug_from_name_and_id(
            name=legacy_testset.name,
            id=UUID(legacy_testset.id),
        ),
        name=legacy_testset.name,
        data=(
            TestsetRevisionData(
                testcases=[
                    Testcase(
                        data=testcase_data,
                        testset_id=UUID(legacy_testset.id),
                    )
                    for testcase_data in legacy_testset.csvdata
                ]
            )
            if legacy_testset.csvdata
            else None
        ),
    )

    # print(" --- testset_revision:", testset_revision)

    return testset_revision


async def _list_legacy_testsets(
    #
) -> List[TestsetRevision]:
    response = authed_api()(
        method="GET",
        endpoint="/testsets/",
    )

    if response.status_code != 200:
        print("Failed to list testsets:", response.status_code, response.text)
        return []

    legacy_testsets = [LegacyTestset(**testset) for testset in response.json()]

    # print(" --- legacy_testsets:", legacy_testsets)

    testset_revisions = [
        TestsetRevision(
            id=UUID(legacy_testset.id),
            slug=get_slug_from_name_and_id(
                name=legacy_testset.name,
                id=UUID(legacy_testset.id),
            ),
            name=legacy_testset.name,
            data=(
                TestsetRevisionData(
                    testcases=[
                        Testcase(
                            data=testcase_data,
                            testset_id=UUID(legacy_testset.id),
                        )
                        for testcase_data in legacy_testset.csvdata
                    ]
                )
                if legacy_testset.csvdata
                else None
            ),
        )
        for legacy_testset in legacy_testsets
        if legacy_testset.id and legacy_testset.name
    ]

    # print(" --- testset_revisions:", testset_revisions)

    return testset_revisions


async def _retrieve_testset(
    testset_id: Optional[UUID] = None,
    testset_revision_id: Optional[UUID] = None,
) -> Optional[TestsetRevision]:
    payload = {
        "testset_ref": (
            {
                "id": str(testset_id) if testset_id else None,
            }
            if testset_id
            else None
        ),
        "testset_revision_ref": (
            {
                "id": str(testset_revision_id) if testset_revision_id else None,
            }
            if testset_revision_id
            else None
        ),
    }

    # print(" --- payload:", payload)

    response = authed_api()(
        method="POST",
        endpoint="/preview/testsets/revisions/retrieve",
        json=payload,
    )
    response.raise_for_status()

    testset_revision_response = TestsetRevisionResponse(**response.json())

    testset_revision = testset_revision_response.testset_revision

    # print(" --- testset_revision:", testset_revision)

    return testset_revision


async def _sync_legacy_testset(
    *,
    testset_id: Optional[UUID] = None,
    #
    csvdata: List[Dict[str, Any]],
    #
    name: Optional[str] = None,
) -> Optional[TestsetRevision]:
    try:
        # print("\n---------   UPSERT TESTSET")

        # print(" ---:", testset_revision_data.model_dump(mode="json", exclude_none=True))

        testset_revision = await _fetch_legacy_testset(
            testset_id=testset_id,
            name=name,
        )

    except Exception as e:
        print("[ERROR]: Failed to prepare testset:", e)
        return None

    # print("Fetch response:", testset_revision)

    if testset_revision and testset_revision.testset_id:
        # print(" --- Editing testset...", testset_id)

        testset_revision = await _edit_legacy_testset(
            testset_id=testset_revision.testset_id,
            name=name,
            csvdata=csvdata,
        )

        # print("Edit response:", testset_revision)

    else:
        # print(" --- Creating testset...", name, data)

        testset_revision = await _create_legacy_testset(
            testset_id=testset_id,
            name=name,
            csvdata=csvdata,
        )

    if not testset_revision or not testset_revision.id:
        return None

    # print(" --- testset_revision:", testset_revision)

    return testset_revision


async def aupsert(
    *,
    testset_id: Optional[UUID] = None,
    #
    name: Optional[str] = None,
    #
    data: List[Dict[str, Any]] | TestsetRevisionData,
) -> Optional[TestsetRevision]:
    csvdata = list()
    if isinstance(data, TestsetRevisionData) and data.testcases:
        csvdata = [testcase.data for testcase in data.testcases]
    elif isinstance(data, list):
        csvdata = data
    else:
        csvdata = list()

    return await _sync_legacy_testset(
        testset_id=testset_id,
        name=name,
        csvdata=csvdata,  # type: ignore
    )


async def acreate(
    *,
    testset_id: Optional[UUID | str] = None,
    #
    name: Optional[str] = None,
    #
    data: List[Dict[str, Any]] | TestsetRevisionData,
) -> Optional[TestsetRevision]:
    csvdata = list()
    if isinstance(data, TestsetRevisionData) and data.testcases:
        csvdata = [testcase.data for testcase in data.testcases]
    elif isinstance(data, list):
        csvdata = data
    else:
        csvdata = list()

    return await _create_legacy_testset(
        testset_id=(
            testset_id
            if isinstance(testset_id, UUID)
            else UUID(testset_id)
            if testset_id
            else None
        ),
        name=name,
        csvdata=csvdata,  # type: ignore
    )


async def aedit(
    *,
    testset_id: UUID | str,
    #
    name: Optional[str] = None,
    #
    data: List[Dict[str, Any]] | TestsetRevisionData,
) -> Optional[TestsetRevision]:
    csvdata = list()
    if isinstance(data, TestsetRevisionData) and data.testcases:
        csvdata = [testcase.data for testcase in data.testcases]
    elif isinstance(data, list):
        csvdata = data
    else:
        csvdata = list()

    return await _edit_legacy_testset(
        testset_id=testset_id if isinstance(testset_id, UUID) else UUID(testset_id),
        name=name,
        csvdata=csvdata,  # type: ignore
    )


async def afetch(
    *,
    testset_id: UUID | str,
) -> Optional[TestsetRevision]:
    return await _fetch_legacy_testset(
        testset_id=testset_id if isinstance(testset_id, UUID) else UUID(testset_id)
    )


async def alist(
    #
) -> List[TestsetRevision]:
    return await _list_legacy_testsets()


async def aretrieve(
    testset_id: Optional[UUID] = None,
    #
    testset_revision_id: Optional[UUID] = None,
) -> Optional[TestsetRevision]:
    # print("\n--------- RETRIEVE TESTSET")

    response = await _retrieve_testset(
        testset_id=testset_id,
        testset_revision_id=testset_revision_id,
    )

    return response
