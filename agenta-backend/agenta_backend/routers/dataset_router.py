from fastapi import HTTPException, APIRouter, UploadFile, File, Form, Body
from agenta_backend.services.db_mongo import datasets
from agenta_backend.models.api.dataset_model import UploadResponse, DeleteDatasets, NewDataSet
from datetime import datetime
from typing import Optional, List
from bson import ObjectId
import csv

upload_folder = './path/to/upload/folder'

router = APIRouter()


@router.post('/upload', response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...), dataset_name: Optional[str] = File(None), app_name:str = Form(None)):
    """
    Uploads a CSV file and saves its data to MongoDB.

    Args:
        file (UploadFile): The CSV file to upload.
        dataset_name (Optional): the name of the dataset if provided.

    Returns:
        dict: The result of the upload process.
    """
    try:
        # Read and parse the CSV file
        csv_data = await file.read()
        csv_text = csv_data.decode('utf-8')
        csv_reader = csv.reader(csv_text.splitlines())
        columns = next(csv_reader)  # Get the column names

        # Create a document with the CSV data
        document = {
            "created_at": datetime.now().isoformat(),
            "name": dataset_name if dataset_name else file.filename,
            "app_name": app_name,
            "csvdata": []
        }
        # Populate the document with column names and values
        for row in csv_reader:
            row_data = {}
            for i, value in enumerate(row):
                row_data[columns[i]] = value
            document["csvdata"].append(row_data)

        result = await datasets.insert_one(document)

        if result.acknowledged:
            return UploadResponse(
                id=str(result.inserted_id),
                name=document["name"],
                created_at=document["created_at"]
            )
    except Exception as e:
        print(e)
        raise HTTPException(
            status_code=500, detail="Failed to process file") from e


@router.post("/{app_name}")
async def create_dataset(app_name: str, csvdata: NewDataSet = Body(...)):
    """
    Create a dataset with given name and app_name, save the dataset to MongoDB.

    Args:
    name (str): name of the test set.
    app_name (str): name of the application.
    dataset (Dict[str, str]): test set data.

    Returns:
    str: The id of the test set created.
    """
    dataset = {
        "name": csvdata.name,
        "app_name": app_name,
        "created_at": datetime.now(),
        "csvdata": csvdata.csvdata
    }
    try:
        result = await datasets.insert_one(dataset)
        if result.acknowledged:
            dataset["_id"] = str(result.inserted_id)
            return dataset
    except Exception as e:
        print(str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/")
async def get_datasets(app_name: Optional[str] = None):
    """
    Get all datasets.

    Returns:
    - A list of dataset objects.

    Raises:
    - `HTTPException` with status code 404 if no datasets are found.
    """
    cursor = datasets.find({"app_name": app_name}, {"_id": 1, "name": 1, "created_at": 1})
    documents = await cursor.to_list(length=100)
    for document in documents:
        document['_id'] = str(document['_id'])
    return documents


@router.get("/{dataset_id}", tags=["datasets"])
async def get_dataset(dataset_id: str):
    """
    Fetch a specific dataset in a MongoDB collection using its _id.

    Args:
        dataset_id (str): The _id of the dataset to fetch.

    Returns:
        The requested dataset if found, else an HTTPException.
    """
    dataset = await datasets.find_one({"_id": ObjectId(dataset_id)})

    if dataset:
        dataset["_id"] = str(dataset["_id"])
        return dataset
    else:
        raise HTTPException(status_code=404, detail=f"dataset with id {dataset_id} not found")


@router.delete("/", response_model=List[str])
async def delete_datasets(deleteDatasets: DeleteDatasets):
    """
    Delete specific datasets based on their unique IDs.

    Args:
    dataset_ids (List[str]): The unique identifiers of the datasets to delete.

    Returns:
    A list of the deleted datasets' IDs.
    """
    deleted_ids = []

    for dataset_id in deleteDatasets.dataset_ids:
        dataset = await datasets.find_one({'_id': ObjectId(dataset_id)})

        if dataset is not None:
            result = await datasets.delete_one({'_id': ObjectId(dataset_id)})
            if result:
                deleted_ids.append(dataset_id)
        else:
            raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

    return deleted_ids