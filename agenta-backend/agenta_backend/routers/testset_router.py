import os
import csv
import json
import requests
from bson import ObjectId
from datetime import datetime
from typing import Optional, List

from fastapi import HTTPException, APIRouter, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse

from agenta_backend.models.api.testset_model import (
    TestSetSimpleResponse,
    DeleteTestsets,
    NewTestset,
    TestSetOutputResponse,
)
from agenta_backend.utils.common import engine, check_access_to_app
from agenta_backend.models.db_models import TestSetDB
from agenta_backend.services.db_manager import get_user_object
from agenta_backend.services import db_manager
from agenta_backend.models.converters import testset_db_to_pydantic

upload_folder = "./path/to/upload/folder"

router = APIRouter()


if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id


@router.post("/upload/", response_model=TestSetSimpleResponse)
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

    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    access_app = await check_access_to_app(
        user_org_data=user_org_data, app_id=app_id, check_owner=False
    )
    if not access_app:
        error_msg = f"You do not have access to this app: {app_id}"
        return JSONResponse(
            {"detail": error_msg},
            status_code=400,
        )
    app = await db_manager.fetch_app_by_id(app_id=app_id)
    # Create a document
    document = {
        "created_at": datetime.now().isoformat(),
        "name": testset_name if testset_name else file.filename,
        "app": app,
        "organization": app.organization,
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
        csv_reader = csv.reader(csv_text.splitlines())
        columns = next(csv_reader)  # Get the column names

        # Populate the document with column names and values
        for row in csv_reader:
            row_data = {}
            for i, value in enumerate(row):
                row_data[columns[i]] = value
            document["csvdata"].append(row_data)

    user = await get_user_object(user_org_data["uid"])
    testset_instance = TestSetDB(**document, user=user)
    result = await engine.save(testset_instance)

    if isinstance(result.id, ObjectId):
        return TestSetSimpleResponse(
            id=str(result.id),
            name=document["name"],
            created_at=document["created_at"],
        )


@router.post("/endpoint/", response_model=TestSetSimpleResponse)
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
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    access_app = await check_access_to_app(
        user_org_data=user_org_data, app_id=app_id, check_owner=False
    )
    if not access_app:
        error_msg = f"You do not have access to this app: {app_id}"
        return JSONResponse(
            {"detail": error_msg},
            status_code=400,
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
            "csvdata": [],
        }

        # Populate the document with column names and values
        json_response = response.json()
        for row in json_response:
            document["csvdata"].append(row)

        user = await get_user_object(user_org_data["uid"])
        testset_instance = TestSetDB(**document, user=user)
        result = await engine.save(testset_instance)

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


@router.post("/{app_id}/")
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

    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    user = await get_user_object(user_org_data["uid"])
    access_app = await check_access_to_app(
        user_org_data=user_org_data, app_id=app_id, check_owner=False
    )
    if not access_app:
        error_msg = f"You do not have access to this app: {app_id}"
        return JSONResponse(
            {"detail": error_msg},
            status_code=400,
        )
    app = await db_manager.fetch_app_by_id(app_id=app_id)
    testset = {
        "created_at": datetime.now().isoformat(),
        "name": csvdata.name,
        "app": app,
        "organization": app.organization,
        "csvdata": csvdata.csvdata,
        "user": user,
    }

    try:
        testset_instance = TestSetDB(**testset)
        await engine.save(testset_instance)

        if testset_instance is not None:
            return TestSetSimpleResponse(
                id=str(testset_instance.id),
                name=testset_instance.name,
                created_at=str(testset_instance.created_at),
            )
    except Exception as e:
        print(str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{testset_id}/")
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
    testset_update = {
        "name": csvdata.name,
        "csvdata": csvdata.csvdata,
        "updated_at": datetime.now().isoformat(),
    }
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)

    test_set = await db_manager.fetch_testset_by_id(testset_id=testset_id)
    if test_set is None:
        raise HTTPException(status_code=404, detail="testset not found")
    access_app = await check_access_to_app(
        user_org_data=user_org_data, app_id=str(test_set.app.id), check_owner=False
    )
    if not access_app:
        error_msg = f"You do not have access to this app: {test_set.app.id}"
        return JSONResponse(
            {"detail": error_msg},
            status_code=400,
        )
    try:
        test_set.update(testset_update)
        await engine.save(test_set)

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


@router.get("/", tags=["testsets"])
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
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    access_app = await check_access_to_app(
        user_org_data=user_org_data, app_id=app_id, check_owner=False
    )
    if not access_app:
        error_msg = f"You do not have access to this app: {app_id}"
        return JSONResponse(
            {"detail": error_msg},
            status_code=400,
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


@router.get("/{testset_id}/", tags=["testsets"])
async def get_testset(
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
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    test_set = await db_manager.fetch_testset_by_id(testset_id=testset_id)
    if test_set is None:
        raise HTTPException(status_code=404, detail="testset not found")
    access_app = await check_access_to_app(
        user_org_data=user_org_data, app_id=str(test_set.app.id), check_owner=False
    )
    if not access_app:
        error_msg = "You do not have access to this test set"
        return JSONResponse(
            {"detail": error_msg},
            status_code=400,
        )
    return testset_db_to_pydantic(test_set)


@router.delete("/", response_model=List[str])
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
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)

    deleted_ids = []

    for testset_id in delete_testsets.testset_ids:
        test_set = await db_manager.fetch_testset_by_id(testset_id=testset_id)
        if test_set is None:
            raise HTTPException(status_code=404, detail="testset not found")
        access_app = await check_access_to_app(
            user_org_data=user_org_data,
            app_id=str(test_set.app.id),
            check_owner=False,
        )
        if not access_app:
            error_msg = "You do not have access to this test set"
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        await engine.delete(test_set)
        deleted_ids.append(testset_id)

    return deleted_ids
