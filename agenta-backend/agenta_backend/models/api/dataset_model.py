from pydantic import BaseModel, Field
from typing import Any, Optional, List


class DatasetModel(BaseModel):
    column_name: str = Field(...)
    column_value: Any = Field(...)
    dataset_id: str = Field(...)
    app_id: str = Field(...)

    class Config:
        schema_extra = {
            "example": {
                "column_name": "column1",
                "column_value": "value1",
                "dataset_id": "your-dataset-id",
                "app_id": "your-app-id"
            }
        }

class UploadResponse(BaseModel):
    id: str
    name: str
    created_at: str


class DeleteDatasets(BaseModel):
    dataset_ids: List[str]
