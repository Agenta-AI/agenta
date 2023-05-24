import os
from fastapi import HTTPException, APIRouter, UploadFile, File
from agenta_backend.services.db_mongo import datasets
from agenta_backend.models.api.dataset_model import DatasetModel, UploadResponse
from agenta_backend.services.db_mongo import datasets
from datetime import datetime
from bson import ObjectId
import csv

upload_folder = './path/to/upload/folder'

router = APIRouter()


@router.post('/upload', response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    """
    Uploads a CSV file and saves its data to MongoDB.

    Args:
        file (UploadFile): The CSV file to upload.

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
            "created_date": datetime.now().isoformat(),
            "name": file.filename,
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
                created_date=document["created_date"]
            )
    except Exception as e:
        print(e)
        raise HTTPException(
            status_code=500, detail="Failed to process file") from e


@router.post("/", response_model=DatasetModel)
async def save_dataset(dataset: DatasetModel):
    """
    Save a new dataset document to MongoDB.

    Args:
        dataset (DatasetModel): The dataset document to save.

    Returns:
        The saved dataset document.
    """
    dataset_doc = dataset.dict()
    result = await datasets.insert_one(dataset_doc)
    if result.acknowledged:
        return DatasetModel(**dataset_doc)
    else:
        raise HTTPException(
            status_code=400, detail="Insert operation was not successful.")


# @router.get("/", response_model=List[UploadResponse])
@router.get("/")
async def get_datasets():
    """
    Get all datasets.

    Returns:
    - A list of dataset objects.

    Raises:
    - `HTTPException` with status code 404 if no datasets are found.
    """
    cursor = datasets.find({}, {"_id": 1, "name": 1, "created_date": 1})
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
