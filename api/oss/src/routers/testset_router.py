import io
import os
import csv
import json
import requests
from pathlib import Path
from typing import Optional, List
from datetime import datetime, timezone

from pydantic import ValidationError
from fastapi.responses import JSONResponse
from fastapi import HTTPException, UploadFile, File, Form, Request

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.converters import testset_db_to_pydantic

from oss.src.models.api.testset_model import (
    NewTestset,
    DeleteTestsets,
    TestSetSimpleResponse,
    TestSetOutputResponse,
)

PARENT_DIRECTORY = Path(__file__).parent
ASSETS_DIRECTORY = os.path.join(str(PARENT_DIRECTORY), "/resources/default_testsets")

if is_ee():
    from ee.src.utils.permissions import (
        check_action_access,
    )  # noqa pylint: disable-all
    from ee.src.models.shared_models import (
        Permission,
    )  # noqa pylint: disable-all


router = APIRouter()

log = get_module_logger(__name__)

upload_folder = "./path/to/upload/folder"

TESTSETS_COUNT_LIMIT = 10 * 1_000  # 10,000 testcases per testset
TESTSETS_SIZE_LIMIT = 10 * 1024 * 1024  # 10 MB per testset

TESTSETS_COUNT_WARNING = f"Test set exceeds the maximum count of {TESTSETS_COUNT_LIMIT} test cases per test set."
TESTSETS_SIZE_WARNING = f"Test set exceeds the maximum size of {TESTSETS_SIZE_LIMIT // (1024 * 1024)} MB per test set."

TESTSETS_SIZE_EXCEPTION = HTTPException(
    status_code=400,
    detail=TESTSETS_SIZE_WARNING,
)

TESTSETS_COUNT_EXCEPTION = HTTPException(
    status_code=400,
    detail=TESTSETS_COUNT_WARNING,
)


def _validate_testset_limits(rows: List[dict]) -> tuple[int, int]:
    total_size = 2
    i = -1
    for i, row in enumerate(rows):
        row_str = json.dumps(row)
        total_size += len(row_str.encode("utf-8"))
        if i > 0:
            total_size += 1
        if i + 1 > TESTSETS_COUNT_LIMIT:
            log.error(TESTSETS_COUNT_WARNING)
            raise TESTSETS_COUNT_EXCEPTION
        if total_size > TESTSETS_SIZE_LIMIT:
            log.error(TESTSETS_SIZE_WARNING)
            raise TESTSETS_SIZE_EXCEPTION
    return i + 1, total_size


@router.post(
    "/upload/", response_model=TestSetSimpleResponse, operation_id="upload_file"
)
async def upload_file(
    request: Request,
    upload_type: str = Form(None),
    file: UploadFile = File(...),
    testset_name: Optional[str] = File(None),
):
    """
    Uploads a CSV or JSON file and saves its data to Postgres.

    Args:
    upload_type : Either a json or csv file.
        file (UploadFile): The CSV or JSON file to upload.
        testset_name (Optional): the name of the testset if provided.

    Returns:
        dict: The result of the upload process.
    """

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.CREATE_TESTSET,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            log.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    if file.size > TESTSETS_SIZE_LIMIT:  # Preemptively check file size
        raise TESTSETS_SIZE_EXCEPTION

    # Create a document
    document = {
        "name": testset_name if testset_name else file.filename,
        "csvdata": [],
    }

    if upload_type.upper() == "JSON":
        # Read and parse the JSON file
        json_data = await file.read()
        json_text = json_data.decode("utf-8")
        json_object = json.loads(json_text)

        # Populate the document with column names and values
        for i, row in enumerate(json_object):
            document["csvdata"].append(row)

    elif upload_type.upper() == "CSV" or upload_type is None:
        # Read and parse the CSV file
        csv_data = await file.read()
        csv_text = csv_data.decode("utf-8")

        # Use StringIO to create a file-like object from the string
        csv_file_like_object = io.StringIO(csv_text)
        csv_reader = csv.DictReader(csv_file_like_object)

        # Populate the document with rows from the CSV reader
        for i, row in enumerate(csv_reader):
            document["csvdata"].append(row)

    else:
        log.error(f"Unsupported upload type: {upload_type}")
        raise HTTPException(status_code=400, detail="Unsupported upload type")

    _validate_testset_limits(document["csvdata"])

    try:
        testset = await db_manager.create_testset(
            project_id=request.state.project_id,
            testset_data=document,
        )
        return TestSetSimpleResponse(
            id=str(testset.id),
            name=document["name"],
            created_at=str(testset.created_at),
        )
    except ValidationError as e:
        raise HTTPException(status_code=403, detail=e.errors())


@router.post(
    "/endpoint/", response_model=TestSetSimpleResponse, operation_id="import_testset"
)
async def import_testset(
    request: Request,
    endpoint: str = Form(None),
    testset_name: str = Form(None),
    authorization: Optional[str] = None,
):
    """
    Import JSON testset data from an endpoint and save it to Postgres.

    Args:
        endpoint (str): An endpoint URL to import data from.
        testset_name (str): the name of the testset if provided.

    Returns:
        dict: The result of the import process.
    """

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.CREATE_TESTSET,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            log.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    try:
        response = requests.get(
            endpoint,
            timeout=10,
            headers={"Authorization": authorization} if authorization else None,
        )
        if response.status_code != 200:
            raise HTTPException(
                status_code=400, detail="Failed to fetch testset from endpoint"
            )

        # Create a document
        document = {
            "name": testset_name,
            "csvdata": [],
        }

        # Populate the document with column names and values
        json_response = response.json()

        _validate_testset_limits(json_response)

        for row in json_response:
            document["csvdata"].append(row)

        testset = await db_manager.create_testset(
            project_id=request.state.project_id,
            testset_data=document,
        )
        return TestSetSimpleResponse(
            id=str(testset.id),
            name=document["name"],
            created_at=str(testset.created_at),
        )

    except HTTPException as error:
        log.error(error)
        raise error
    except json.JSONDecodeError as error:
        log.error(error)
        raise HTTPException(
            status_code=400, detail="Endpoint does not return valid JSON testset data"
        ) from error
    except Exception as error:
        log.error(error)
        raise HTTPException(
            status_code=500, detail="Failed to import testset from endpoint"
        ) from error


@router.post("/", response_model=TestSetSimpleResponse, operation_id="create_testset")
async def create_testset(
    csvdata: NewTestset,
    request: Request,
):
    """
    Create a testset with given name, save the testset to Postgres.

    Args:
    name (str): name of the test set.
    testset (Dict[str, str]): test set data.

    Returns:
    str: The id of the test set created.
    """

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.CREATE_TESTSET,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            log.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    _validate_testset_limits(csvdata.csvdata)

    testset_data = {
        "name": csvdata.name,
        "csvdata": csvdata.csvdata,
    }
    testset_instance = await db_manager.create_testset(
        project_id=request.state.project_id,
        testset_data=testset_data,
    )
    if testset_instance is not None:
        return TestSetSimpleResponse(
            id=str(testset_instance.id),
            name=testset_instance.name,  # type: ignore
            created_at=str(testset_instance.created_at),
        )


@router.put("/{testset_id}/", operation_id="update_testset")
async def update_testset(
    testset_id: str,
    csvdata: NewTestset,
    request: Request,
):
    """
    Update a testset with given id, update the testset in Postgres.

    Args:
    testset_id (str): id of the test set to be updated.
    csvdata (NewTestset): New data to replace the old testset.

    Returns:
    str: The id of the test set updated.
    """

    testset = await db_manager.fetch_testset_by_id(testset_id=testset_id)
    if testset is None:
        raise HTTPException(status_code=404, detail="testset not found")

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(testset.project_id),
            permission=Permission.EDIT_TESTSET,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            log.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    _validate_testset_limits(csvdata.csvdata)

    testset_update = {
        "name": csvdata.name,
        "csvdata": csvdata.csvdata,
        "updated_at": datetime.now(timezone.utc),
    }
    await db_manager.update_testset(
        testset_id=str(testset.id), values_to_update=testset_update
    )
    return {
        "status": "success",
        "message": "testset updated successfully",
        "_id": testset_id,
    }


@router.get("/", operation_id="get_testsets")
async def get_testsets(
    request: Request,
) -> List[TestSetOutputResponse]:
    """
    Get all testsets.

    Returns:
    - A list of testset objects.

    Raises:
    - `HTTPException` with status code 404 if no testsets are found.
    """

    try:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSET,
            )
            if not has_permission:
                error_msg = (
                    "You do not have permission to perform this action. "
                    + "Please contact your organization admin."
                )
                log.error(error_msg)

                return JSONResponse(
                    status_code=403,
                    content={"detail": error_msg},
                )

        testsets = await db_manager.fetch_testsets_by_project_id(
            project_id=request.state.project_id,
        )

        return [
            TestSetOutputResponse(
                _id=str(testset.id),  # type: ignore
                name=testset.name,
                created_at=str(testset.created_at),
                updated_at=str(testset.updated_at),
            )
            for testset in testsets
        ]

    except Exception as e:
        log.exception(f"An error occurred: {str(e)}")

        raise HTTPException(
            status_code=500,
            detail=str(e),
        )


@router.get("/{testset_id}/", operation_id="get_single_testset")
async def get_single_testset(
    testset_id: str,
    request: Request,
):
    """
    Fetch a specific testset in Postgres.

    Args:
        testset_id (str): The id of the testset to fetch.

    Returns:
        The requested testset if found, else an HTTPException.
    """

    try:
        test_set = await db_manager.fetch_testset_by_id(testset_id=testset_id)
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(test_set.project_id),
                permission=Permission.VIEW_TESTSET,
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                log.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        if test_set is None:
            raise HTTPException(status_code=404, detail="testset not found")
        return testset_db_to_pydantic(test_set)
    except Exception as exc:
        status_code = exc.status_code if hasattr(exc, "status_code") else 500  # type: ignore
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.delete("/", response_model=List[str], operation_id="delete_testsets")
async def delete_testsets(
    payload: DeleteTestsets,
    request: Request,
):
    """
    Delete specific testsets based on their unique IDs.

    Args:
    testset_ids (List[str]): The unique identifiers of the testsets to delete.

    Returns:
    A list of the deleted testsets' IDs.
    """

    if is_ee():
        for testset_id in payload.testset_ids:
            testset = await db_manager.fetch_testset_by_id(testset_id=testset_id)
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(testset.project_id),
                permission=Permission.DELETE_TESTSET,
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                log.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

    await db_manager.remove_testsets(testset_ids=payload.testset_ids)
    return payload.testset_ids
