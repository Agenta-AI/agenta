import json
from typing import Any, Dict, List

from pydantic import BaseModel, Extra


class InFile:
    def __init__(self, file_name: str, file_path: str):
        self.file_name = file_name
        self.file_path = file_path


class TextParam(str):

    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update({"x-parameter": "text"})


class FloatParam(float):

    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update({"x-parameter": "float"})


class Context(BaseModel):

    class Config:
        extra = Extra.allow

    def to_json(self):
        return self.json()

    @classmethod
    def from_json(cls, json_str: str):
        data = json.loads(json_str)
        return cls(**data)
