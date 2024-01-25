import io
import os
import csv
import json
import logging
import requests

from bson import ObjectId
from datetime import datetime
from typing import Optional, List
from pydantic import ValidationError
from fastapi.responses import JSONResponse
from agenta_backend.services import db_manager
from agenta_backend.utils.common import APIRouter
from agenta_backend.services.db_manager import get_user
from fastapi import HTTPException, UploadFile, File, Form, Request
from agenta_backend.models.converters import testset_db_to_pydantic


from agenta_backend.models.api.testset_model import (
    NewTestset,
    DeleteTestsets,
    TestSetSimpleResponse,
    TestSetOutputResponse,
)

FEATURE_FLAG = os.environ["FEATURE_FLAG"]
if FEATURE_FLAG in ["cloud", "ee"]:
    from agenta_backend.commons.utils.permissions import (
        check_action_access,
    )  # noqa pylint: disable-all
    from agenta_backend.commons.models.db_models import (
        Permission,
    )  # noqa pylint: disable-all
    from agenta_backend.commons.models.db_models import (
        TestSetDB_ as TestSetDB,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.models.db_models import TestSetDB

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

upload_folder = "./path/to/upload/folder"


@router.post(
    "/upload/", response_model=TestSetSimpleResponse, operation_id="upload_file"
)
async def upload_file(
    request: Request,
    upload_type: str = Form(None),
    file: UploadFile = File(...),
    testset_name: Optional[str] = File(None),
    app_id: str = Form(None),
):
    """
    Uploads a CSV or JSON file and saves its data to MongoDB.

    Args:
    upload_type : Either a json or csv file.
        file (UploadFile): The CSV or JSON file to upload.
        testset_name (Optional): the name of the testset if provided.

    Returns:
        dict: The result of the upload process.
    """

    if FEATURE_FLAG in ["cloud", "ee"]:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            object_id=app_id,
            object_type="app",
            permission=Permission.CREATE_TESTSET,
        )
        logger.debug(f"User has Permission to upload Testset: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    app = await db_manager.fetch_app_by_id(app_id=app_id)
    # Create a document
    document = {
        "created_at": datetime.now().isoformat(),
        "name": testset_name if testset_name else file.filename,
        "app": app,
        "organization": app.organization,
        "workspace": app.workspace,
        "csvdata": [],
    }

    if upload_type == "JSON":
        # Read and parse the JSON file
        json_data = await file.read()
        json_text = json_data.decode("utf-8")
        json_object = json.loads(json_text)

        # Populate the document with column names and values
        for row in json_object:
            document["csvdata"].append(row)

    else:
        # Read and parse the CSV file
        csv_data = await file.read()
        csv_text = csv_data.decode("utf-8")

        # Use StringIO to create a file-like object from the string
        csv_file_like_object = io.StringIO(csv_text)
        csv_reader = csv.DictReader(csv_file_like_object)

        # Populate the document with rows from the CSV reader
        for row in csv_reader:
            document["csvdata"].append(row)

    user = await get_user(request.state.user_id)
    try:
        testset_instance = TestSetDB(**document, user=user)
    except ValidationError as e:
        raise HTTPException(status_code=403, detail=e.errors())
    result = await testset_instance.create()

    if isinstance(result.id, ObjectId):
        return TestSetSimpleResponse(
            id=str(result.id),
            name=document["name"],
            created_at=document["created_at"],
        )


@router.post(
    "/endpoint/", response_model=TestSetSimpleResponse, operation_id="import_testset"
)
async def import_testset(
    request: Request,
    endpoint: str = Form(None),
    testset_name: str = Form(None),
    app_id: str = Form(None),
):
    """
    Import JSON testset data from an endpoint and save it to MongoDB.

    Args:
        endpoint (str): An endpoint URL to import data from.
        testset_name (str): the name of the testset if provided.

    Returns:
        dict: The result of the import process.
    """
    if FEATURE_FLAG in ["cloud", "ee"]:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            object_id=app_id,
            object_type="app",
            permission=Permission.CREATE_TESTSET,
        )
        logger.debug(f"User has Permission to import Testset: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    app = await db_manager.fetch_app_by_id(app_id=app_id)

    try:
        response = requests.get(endpoint, timeout=10)

        if response.status_code != 200:
            raise HTTPException(
                status_code=400, detail="Failed to fetch testset from endpoint"
            )

        # Create a document
        document = {
            "created_at": datetime.now().isoformat(),
            "name": testset_name,
            "app": app,
            "organization": app.organization,
            "workspace": app.workspace,
            "csvdata": [],
        }

        # Populate the document with column names and values
        json_response = response.json()
        for row in json_response:
            document["csvdata"].append(row)

        user = await get_user(request.state.user_id)
        testset_instance = TestSetDB(**document, user=user)
        result = await testset_instance.create()

        if isinstance(result.id, ObjectId):
            return TestSetSimpleResponse(
                id=str(result.id),
                name=document["name"],
                created_at=document["created_at"],
            )

    except HTTPException as error:
        print(error)
        raise error
    except json.JSONDecodeError as error:
        print(error)
        raise HTTPException(
            status_code=400, detail="Endpoint does not return valid JSON testset data"
        ) from error
    except Exception as error:
        print(error)
        raise HTTPException(
            status_code=500, detail="Failed to import testset from endpoint"
        ) from error


@router.post(
    "/{app_id}/", response_model=TestSetSimpleResponse, operation_id="create_testset"
)
async def create_testset(
    app_id: str,
    csvdata: NewTestset,
    request: Request,
):
    """
    Create a testset with given name and app_name, save the testset to MongoDB.

    Args:
    name (str): name of the test set.
    app_name (str): name of the application.
    testset (Dict[str, str]): test set data.

    Returns:
    str: The id of the test set created.
    """

    if FEATURE_FLAG in ["cloud", "ee"]:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            object_id=app_id,
            object_type="app",
            permission=Permission.CREATE_TESTSET,
        )
        logger.debug(f"User has Permission to create Testset: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    user = await get_user(request.state.user_id)
    app = await db_manager.fetch_app_by_id(app_id=app_id)
    testset = {
        "created_at": datetime.now().isoformat(),
        "name": csvdata.name,
        "app": app,
        "organization": app.organization,
        "workspace": app.workspace,
        "csvdata": csvdata.csvdata,
        "user": user,
    }

    try:
        testset_instance = TestSetDB(**testset)
        await testset_instance.create()

        if testset_instance is not None:
            return TestSetSimpleResponse(
                id=str(testset_instance.id),
                name=testset_instance.name,
                created_at=str(testset_instance.created_at),
            )
    except Exception as e:
        print(str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{testset_id}/", operation_id="update_testset")
async def update_testset(
    testset_id: str,
    csvdata: NewTestset,
    request: Request,
):
    """
    Update a testset with given id, update the testset in MongoDB.

    Args:
    testset_id (str): id of the test set to be updated.
    csvdata (NewTestset): New data to replace the old testset.

    Returns:
    str: The id of the test set updated.
    """
    if FEATURE_FLAG in ["cloud", "ee"]:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            object_id=testset_id,
            object_type="testset",
            permission=Permission.EDIT_TESTSET,
        )
        logger.debug(f"User has Permission to update Testset: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    testset_update = {
        "name": csvdata.name,
        "csvdata": csvdata.csvdata,
        "updated_at": datetime.now().isoformat(),
    }

    test_set = await db_manager.fetch_testset_by_id(testset_id=testset_id)
    if test_set is None:
        raise HTTPException(status_code=404, detail="testset not found")

    try:
        await test_set.update({"$set": testset_update})
        if isinstance(test_set.id, ObjectId):
            return {
                "status": "success",
                "message": "testset updated successfully",
                "_id": testset_id,
            }
        else:
            raise HTTPException(status_code=404, detail="testset not found")
    except Exception as e:
        print(str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", operation_id="get_testsets")
async def get_testsets(
    app_id: str,
    request: Request,
) -> List[TestSetOutputResponse]:
    """
    Get all testsets.

    Returns:
    - A list of testset objects.

    Raises:
    - `HTTPException` with status code 404 if no testsets are found.
    """
    if FEATURE_FLAG in ["cloud", "ee"]:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            object_id=app_id,
            object_type="app",
            permission=Permission.VIEW_TESTSET,
        )
        logger.debug(f"User has Permission to view Testsets: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    app = await db_manager.fetch_app_by_id(app_id=app_id)

    if app is None:
        raise HTTPException(status_code=404, detail="App not found")

    testsets: List[TestSetDB] = await db_manager.fetch_testsets_by_app_id(app_id=app_id)
    return [
        TestSetOutputResponse(
            id=str(testset.id),
            name=testset.name,
            created_at=testset.created_at,
        )
        for testset in testsets
    ]


@router.get("/{testset_id}/", operation_id="get_single_testset")
async def get_single_testset(
    testset_id: str,
    request: Request,
):
    """
    Fetch a specific testset in a MongoDB collection using its _id.

    Args:
        testset_id (str): The _id of the testset to fetch.

    Returns:
        The requested testset if found, else an HTTPException.
    """
    if FEATURE_FLAG in ["cloud", "ee"]:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            object_id=testset_id,
            object_type="testset",
            permission=Permission.VIEW_TESTSET,
        )
        logger.debug(f"User has Permission to view Testset: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    test_set = await db_manager.fetch_testset_by_id(testset_id=testset_id)
    if test_set is None:
        raise HTTPException(status_code=404, detail="testset not found")

    return testset_db_to_pydantic(test_set)


@router.delete("/", response_model=List[str], operation_id="delete_testsets")
async def delete_testsets(
    delete_testsets: DeleteTestsets,
    request: Request,
):
    """
    Delete specific testsets based on their unique IDs.

    Args:
    testset_ids (List[str]): The unique identifiers of the testsets to delete.

    Returns:
    A list of the deleted testsets' IDs.
    """
    if FEATURE_FLAG in ["cloud", "ee"]:
        for testset_id in delete_testsets.testset_ids:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=testset_id,
                object_type="testset",
                permission=Permission.DELETE_TESTSET,
            )
            logger.debug(f"User has Permission to delete Testset: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

    deleted_ids = []
    for testset_id in delete_testsets.testset_ids:
        test_set = await db_manager.fetch_testset_by_id(testset_id=testset_id)
        if test_set is None:
            raise HTTPException(status_code=404, detail="testset not found")

        await test_set.delete()
        deleted_ids.append(testset_id)

    return deleted_ids
