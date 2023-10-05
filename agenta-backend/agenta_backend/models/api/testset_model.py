from datetime import datetime
from typing import Any, List, Dict
from pydantic import BaseModel, Field


class TestsetModel(BaseModel):
    column_name: str = Field(...)
    column_value: Any = Field(...)
    testset_id: str = Field(...)
    app_id: str = Field(...)

    class Config:
        schema_extra = {
            "example": {
                "column_name": "column1",
                "column_value": "value1",
                "testset_id": "your-testset-id",
                "app_id": "your-app-id",
            }
        }


class TestSetSimpleResponse(BaseModel):
    id: str
    name: str
    created_at: str


class DeleteTestsets(BaseModel):
    testset_ids: List[str]


# The NewTestset class represents a new data set.
# Each row is a dictionary with column names as keys and column values as values.
# csvdata = [
#    {
#        "column1": "data1",
#        "column2": "data2",
#        "column3": "data3",
#    }
# ]
class NewTestset(BaseModel):
    name: str
    csvdata: List[Dict[str, str]]


class TestSetOutputResponse(BaseModel):
    id: str = Field(..., alias="_id")
    name: str
    created_at: datetime

    class Config:
        allow_population_by_field_name = True
