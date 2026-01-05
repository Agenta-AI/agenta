from typing import List, Dict, Any, Optional
from uuid import UUID, uuid4

from agenta.sdk.utils.client import authed_api
from agenta.sdk.utils.references import get_slug_from_name_and_id
from agenta.sdk.models.testsets import (
    TestsetRevisionData,
    TestsetRevision,
    #
    TestsetRevisionResponse,
    #
    SimpleTestsetResponse,
)


def _normalize_csvdata(
    data: List[Dict[str, Any]] | TestsetRevisionData,
) -> List[Dict[str, Any]]:
    if isinstance(data, TestsetRevisionData) and data.testcases:
        return [testcase.data for testcase in data.testcases]

    if isinstance(data, list):
        return data

    return []


async def _create_simple_testset(
    *,
    csvdata: List[Dict[str, Any]],
    name: str,
    testset_id: Optional[UUID] = None,
) -> Optional[TestsetRevision]:
    slug_seed = testset_id or uuid4()

    payload = {
        "testset": {
            "slug": get_slug_from_name_and_id(name, slug_seed),
            "name": name,
            "data": {
                "testcases": [
                    {"data": testcase_data}
                    for testcase_data in csvdata
                    if isinstance(testcase_data, dict)
                ]
            },
        }
    }

    response = authed_api()(
        method="POST",
        endpoint="/preview/simple/testsets/",
        json=payload,
    )

    if response.status_code != 200:
        print("Failed to create testset:", response.status_code, response.text)
        return None

    simple_testset_response = SimpleTestsetResponse(**response.json())
    simple_testset = simple_testset_response.testset

    if not simple_testset or not simple_testset.id or not simple_testset.data:
        return None

    retrieved = await _retrieve_testset(testset_id=simple_testset.id)

    if retrieved:
        return retrieved

    return TestsetRevision(
        id=simple_testset.id,
        slug=simple_testset.slug,
        name=simple_testset.name,
        data=simple_testset.data,
        testset_id=simple_testset.id,
    )


async def _fetch_simple_testset(
    testset_id: Optional[UUID] = None,
    name: Optional[str] = None,
) -> Optional[TestsetRevision]:
    if not testset_id and not name:
        return None

    if testset_id:
        response = authed_api()(
            method="GET",
            endpoint=f"/preview/simple/testsets/{testset_id}",
        )

        if response.status_code == 200:
            simple_testset_response = SimpleTestsetResponse(**response.json())
            simple_testset = simple_testset_response.testset

            if simple_testset and simple_testset.id and simple_testset.data:
                retrieved = await _retrieve_testset(
                    testset_id=UUID(str(simple_testset.id))
                )

                if retrieved:
                    return retrieved

                return TestsetRevision(
                    id=simple_testset.id,
                    slug=simple_testset.slug,
                    name=simple_testset.name,
                    data=simple_testset.data,
                    testset_id=simple_testset.id,
                )

        elif response.status_code != 404:
            print("Failed to fetch testset:", response.status_code, response.text)
            return None

    if name:
        response = authed_api()(
            method="POST",
            endpoint="/preview/simple/testsets/query",
            json={"testset": {"name": name}},
        )

        if response.status_code != 200:
            print("Failed to list testsets:", response.status_code, response.text)
            return None

        testsets = response.json().get("testsets", [])

        if testsets:
            first = testsets[0]

            if first.get("id"):
                return await _fetch_simple_testset(testset_id=UUID(first["id"]))

    return None


async def _edit_simple_testset(
    *,
    testset_id: UUID,
    csvdata: List[Dict[str, Any]],
    name: Optional[str] = None,
) -> Optional[TestsetRevision]:
    payload = {
        "testset": {
            "id": str(testset_id),
            "name": name,
            "data": {
                "testcases": [
                    {"data": testcase_data}
                    for testcase_data in csvdata
                    if isinstance(testcase_data, dict)
                ]
            },
        }
    }

    response = authed_api()(
        method="PUT",
        endpoint=f"/preview/simple/testsets/{testset_id}",
        json=payload,
    )

    if response.status_code != 200:
        print("Failed to edit testset:", response.status_code, response.text)
        return None

    simple_testset_response = SimpleTestsetResponse(**response.json())
    simple_testset = simple_testset_response.testset

    if not simple_testset or not simple_testset.id or not simple_testset.data:
        return None

    return TestsetRevision(
        id=simple_testset.id,
        slug=simple_testset.slug,
        name=simple_testset.name,
        data=simple_testset.data,
        testset_id=simple_testset.id,
    )


async def _list_simple_testsets(
    #
) -> List[TestsetRevision]:
    response = authed_api()(
        method="POST",
        endpoint="/preview/simple/testsets/query",
        json={},
    )

    if response.status_code != 200:
        print("Failed to list testsets:", response.status_code, response.text)
        return []

    testsets = response.json().get("testsets", [])
    revisions = []

    for ts in testsets:
        if not ts.get("id"):
            continue

        fetched = await _fetch_simple_testset(testset_id=UUID(ts["id"]))

        if fetched:
            revisions.append(fetched)

    return revisions


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

    response = authed_api()(
        method="POST",
        endpoint="/preview/testsets/revisions/retrieve",
        json=payload,
    )
    response.raise_for_status()

    testset_revision_response = TestsetRevisionResponse(**response.json())

    return testset_revision_response.testset_revision


async def _sync_simple_testset(
    *,
    testset_id: Optional[UUID] = None,
    #
    csvdata: List[Dict[str, Any]],
    #
    name: Optional[str] = None,
) -> Optional[TestsetRevision]:
    try:
        testset_revision = await _fetch_simple_testset(
            testset_id=testset_id,
            name=name,
        )

    except Exception as e:
        print("[ERROR]: Failed to prepare testset:", e)
        return None

    if testset_revision and testset_revision.testset_id:
        return await _edit_simple_testset(
            testset_id=testset_revision.testset_id,
            name=name,
            csvdata=csvdata,
        )

    return await _create_simple_testset(
        name=name or "Testset",
        csvdata=csvdata,
        testset_id=testset_id,
    )


async def aupsert(
    *,
    testset_id: Optional[UUID] = None,
    #
    name: Optional[str] = None,
    #
    data: List[Dict[str, Any]] | TestsetRevisionData,
) -> Optional[TestsetRevision]:
    csvdata = _normalize_csvdata(data)

    return await _sync_simple_testset(
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
    csvdata = _normalize_csvdata(data)

    return await _create_simple_testset(
        testset_id=(
            testset_id
            if isinstance(testset_id, UUID)
            else UUID(testset_id)
            if testset_id
            else None
        ),
        name=name or "Testset",
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
    csvdata = _normalize_csvdata(data)

    return await _edit_simple_testset(
        testset_id=testset_id if isinstance(testset_id, UUID) else UUID(testset_id),
        name=name,
        csvdata=csvdata,  # type: ignore
    )


async def afetch(
    *,
    testset_id: UUID | str,
) -> Optional[TestsetRevision]:
    return await _fetch_simple_testset(
        testset_id=testset_id if isinstance(testset_id, UUID) else UUID(testset_id)
    )


async def alist(
    #
) -> List[TestsetRevision]:
    return await _list_simple_testsets()


async def aretrieve(
    testset_id: Optional[UUID] = None,
    #
    testset_revision_id: Optional[UUID] = None,
) -> Optional[TestsetRevision]:
    return await _retrieve_testset(
        testset_id=testset_id,
        testset_revision_id=testset_revision_id,
    )
