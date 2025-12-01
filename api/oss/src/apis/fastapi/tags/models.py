from typing import List
from pydantic import BaseModel


class TagKeyResponse(BaseModel):
    """Response model for a single tag key"""
    key: str


class TagKeysResponse(BaseModel):
    """Response model for list of tag keys"""
    keys: List[TagKeyResponse]

    class Config:
        json_schema_extra = {
            "example": {
                "keys": [
                    {"key": "env"},
                    {"key": "owner.name"},
                    {"key": "metrics.latency.p95"}
                ]
            }
        }
