import csv
import json
from copy import deepcopy
from bson import ObjectId
from datetime import datetime
from typing import Optional, List

from fastapi import HTTPException, APIRouter, UploadFile, File, Form, Depends

from agenta_backend.models.api.testset_model import (
    UploadResponse,
    DeleteTestsets,
    NewTestset,
)
from agenta_backend.config import settings
from agenta_backend.models.db_models import TestSetDB
from agenta_backend.services.db_manager import engine, query, get_user_object


upload_folder = "./path/to/upload/folder"

router = APIRouter()


if settings.feature_flag in ["cloud", "ee"]:
    from agenta_backend.ee.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.services.selectors import get_user_and_org_id


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    upload_type: str = Form(None),
    file: UploadFile = File(...),
    testset_name: Optional[str] = File(None),
    app_name: str = Form(None),
    stoken_session: SessionContainer = Depends(verify_session()),
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

    kwargs: dict = await get_user_and_org_id(stoken_session)

    try:
        # Create a document
        document = {
            "created_at": datetime.now().isoformat(),
            "name": testset_name if testset_name else file.filename,
            "app_name": app_name,
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

        user = await get_user_object(kwargs["user_id"])
        testset_instance = TestSetDB(**document, user=user)
        result = await engine.save(testset_instance)

        if result is not None:
            return UploadResponse(
                id=str(result.id),
                name=document["name"],
                created_at=document["created_at"],
            )

    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail="Failed to process file") from e


@router.post("/{app_name}")
async def create_testset(
    app_name: str,
    csvdata: NewTestset,
    stoken_session: SessionContainer = Depends(verify_session()),
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

    kwargs: dict = await get_user_and_org_id(stoken_session)
    testset = {
        "name": csvdata.name,
        "app_name": app_name,
        "created_at": datetime.now().isoformat(),
        "csvdata": csvdata.csvdata,
    }
    try:
        user = await get_user_object(kwargs["user_id"])
        testset_instance = TestSetDB(**testset, user=user)
        await engine.save(testset_instance)
        
        if testset_instance is not None:
            testset["_id"] = str(testset_instance.id)
            return testset
    except Exception as e:
        print(str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{testset_id}")
async def update_testset(
    testset_id: str,
    csvdata: NewTestset,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Update a testset with given id, update the testset in MongoDB.

    Args:
    testset_id (str): id of the test set to be updated.
    csvdata (NewTestset): New data to replace the old testset.

    Returns:
    str: The id of the test set updated.
    """
    testset = {
        "name": csvdata.name,
        "csvdata": csvdata.csvdata,
        "updated_at": datetime.now().isoformat(),
    }
    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        user = await get_user_object(kwargs["user_id"])

        # Define query expression
        query_expression = query.eq(TestSetDB.user, user.id) & query.eq(
            TestSetDB.id, ObjectId(testset_id)
        )

        # Find and update testset
        result = await engine.find_one(TestSetDB, query_expression)
        result.update(testset)
        await engine.save(result)

        if result is not None:
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


@router.get("/")
async def get_testsets(
    app_name: Optional[str] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Get all testsets.

    Returns:
    - A list of testset objects.

    Raises:
    - `HTTPException` with status code 404 if no testsets are found.
    """

    kwargs: dict = await get_user_and_org_id(stoken_session)
    user = await get_user_object(kwargs["user_id"])

    # Define query expression
    query_expression = query.eq(TestSetDB.user, user.id) & query.eq(
        TestSetDB.app_name, app_name
    )

    documents = []
    document_dict = {}
    testsets: List[TestSetDB] = await engine.find(TestSetDB, query_expression)
    for document in testsets:
        document_dict["_id"] = str(document.id)
        document_dict["name"] = document.name
        document_dict["app_name"] = document.app_name
        document_dict["created_at"] = document.created_at
        documents.append(deepcopy(document_dict))
    return documents


@router.get("/{testset_id}", tags=["testsets"])
async def get_testset(
    testset_id: str, stoken_session: SessionContainer = Depends(verify_session())
):
    """
    Fetch a specific testset in a MongoDB collection using its _id.

    Args:
        testset_id (str): The _id of the testset to fetch.

    Returns:
        The requested testset if found, else an HTTPException.
    """

    kwargs: dict = await get_user_and_org_id(stoken_session)
    user = await get_user_object(kwargs["user_id"])

    # Define query expression
    query_expression = query.eq(TestSetDB.user, user.id) & query.eq(
        TestSetDB.id, ObjectId(testset_id)
    )

    testset = await engine.find_one(TestSetDB, query_expression)
    if testset is not None:
        return testset
    else:
        raise HTTPException(
            status_code=404, detail=f"testset with id {testset_id} not found"
        )


@router.delete("/", response_model=List[str])
async def delete_testsets(
    delete_testsets: DeleteTestsets,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Delete specific testsets based on their unique IDs.

    Args:
    testset_ids (List[str]): The unique identifiers of the testsets to delete.

    Returns:
    A list of the deleted testsets' IDs.
    """
    deleted_ids = []

    kwargs: dict = await get_user_and_org_id(stoken_session)
    user = await get_user_object(kwargs["user_id"])

    for testset_id in delete_testsets.testset_ids:
        # Define query expression
        query_expression = query.eq(TestSetDB.user, user.id) & query.eq(
            TestSetDB.id, ObjectId(testset_id)
        )
        testset = await engine.find_one(TestSetDB, query_expression)

        if testset is not None:
            await engine.delete(testset)
            deleted_ids.append(testset_id)
        else:
            raise HTTPException(
                status_code=404, detail=f"testset {testset_id} not found"
            )

    return deleted_ids
