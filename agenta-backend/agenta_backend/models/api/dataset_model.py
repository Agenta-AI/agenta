from pydantic import BaseModel, Field
from typing import Any, List, Dict


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

# The NewDataSet class represents a new data set.
# Each row is a dictionary with column names as keys and column values as values.
# csvdata = [
#    {
#        "column1": "data1",
#        "column2": "data2",
#        "column3": "data3",
#    }
# ]
class NewDataSet(BaseModel):
    name: str
    csvdata: List[Dict[str, str]]
