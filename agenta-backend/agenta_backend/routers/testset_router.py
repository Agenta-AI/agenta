from fastapi import HTTPException, APIRouter, UploadFile, File, Form, Body
from agenta_backend.services.db_mongo import testsets
from agenta_backend.models.api.testset_model import (
    UploadResponse,
    DeleteTestsets,
    NewTestset,
)
from datetime import datetime
from typing import Optional, List
from bson import ObjectId
import csv

upload_folder = "./path/to/upload/folder"

router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    testset_name: Optional[str] = File(None),
    app_name: str = Form(None),
):
    """
    Uploads a CSV file and saves its data to MongoDB.

    Args:
        file (UploadFile): The CSV file to upload.
        testset_name (Optional): the name of the testset if provided.

    Returns:
        dict: The result of the upload process.
    """
    try:
        # Read and parse the CSV file
        csv_data = await file.read()
        csv_text = csv_data.decode("utf-8")
        csv_reader = csv.reader(csv_text.splitlines())
        columns = next(csv_reader)  # Get the column names

        # Create a document with the CSV data
        document = {
            "created_at": datetime.now().isoformat(),
            "name": testset_name if testset_name else file.filename,
            "app_name": app_name,
            "csvdata": [],
        }
        # Populate the document with column names and values
        for row in csv_reader:
            row_data = {}
            for i, value in enumerate(row):
                row_data[columns[i]] = value
            document["csvdata"].append(row_data)

        result = await testsets.insert_one(document)

        if result.acknowledged:
            return UploadResponse(
                id=str(result.inserted_id),
                name=document["name"],
                created_at=document["created_at"],
            )
    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail="Failed to process file") from e


@router.post("/{app_name}")
async def create_testset(app_name: str, csvdata: NewTestset):
    """
    Create a testset with given name and app_name, save the testset to MongoDB.

    Args:
    name (str): name of the test set.
    app_name (str): name of the application.
    testset (Dict[str, str]): test set data.

    Returns:
    str: The id of the test set created.
    """
    testset = {
        "name": csvdata.name,
        "app_name": app_name,
        "created_at": datetime.now().isoformat(),
        "csvdata": csvdata.csvdata,
    }
    try:
        result = await testsets.insert_one(testset)
        if result.acknowledged:
            testset["_id"] = str(result.inserted_id)
            return testset
    except Exception as e:
        print(str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{testset_id}")
async def update_testset(testset_id: str, csvdata: NewTestset):
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
        result = await testsets.update_one(
            {"_id": ObjectId(testset_id)}, {"$set": testset}
        )
        if result.acknowledged:
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
async def get_testsets(app_name: Optional[str] = None):
    """
    Get all testsets.

    Returns:
    - A list of testset objects.

    Raises:
    - `HTTPException` with status code 404 if no testsets are found.
    """
    cursor = testsets.find(
        {"app_name": app_name}, {"_id": 1, "name": 1, "created_at": 1}
    )
    documents = await cursor.to_list(length=100)
    for document in documents:
        document["_id"] = str(document["_id"])
    return documents


@router.get("/{testset_id}", tags=["testsets"])
async def get_testset(testset_id: str):
    """
    Fetch a specific testset in a MongoDB collection using its _id.

    Args:
        testset_id (str): The _id of the testset to fetch.

    Returns:
        The requested testset if found, else an HTTPException.
    """
    testset = await testsets.find_one({"_id": ObjectId(testset_id)})

    if testset:
        testset["_id"] = str(testset["_id"])
        return testset
    else:
        raise HTTPException(
            status_code=404, detail=f"testset with id {testset_id} not found"
        )


@router.delete("/", response_model=List[str])
async def delete_testsets(delete_testsets: DeleteTestsets):
    """
    Delete specific testsets based on their unique IDs.

    Args:
    testset_ids (List[str]): The unique identifiers of the testsets to delete.

    Returns:
    A list of the deleted testsets' IDs.
    """
    deleted_ids = []

    for testset_id in delete_testsets.testset_ids:
        testset = await testsets.find_one({"_id": ObjectId(testset_id)})

        if testset is not None:
            result = await testsets.delete_one({"_id": ObjectId(testset_id)})
            if result:
                deleted_ids.append(testset_id)
        else:
            raise HTTPException(
                status_code=404, detail=f"testset {testset_id} not found"
            )

    return deleted_ids
