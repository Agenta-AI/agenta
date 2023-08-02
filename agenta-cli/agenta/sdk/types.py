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




class MultipleChoiceParam(list):
    @classmethod    def __repr__(self):
        if type(self) == MultipleChoiceParam:
            return self[0]
        else:
            return self

    def __int__(self):
        if type(self) == MultipleChoiceParam:
            return int(self[0])
        else:
            return int(self)

    def __eq__(self, other):
        if type(self) == MultipleChoiceParam:
            return self[0] == other
        else:
            return self == other

    def __str__(self):
        if type(self) == MultipleChoiceParam:
            return self[0]
        else:
            return self


    def __modify_schema__(cls, field_schema: dict[str, Any]):
        field_schema.update(
            {
                "x-parameter": "choice",
                "type": "string",
                "enum": [],
            }
        )
    
    @classmethod
    def __get_validators__(cls):
        # Override the validators to treat 
        # MultipleChoiceParam as a string type
        yield cls.validate_multiple_choice_param

    @classmethod
    def validate_multiple_choice_param(cls, v):
        if isinstance(v, MultipleChoiceParam):
            return v[0]  # Return the first element as a string
        return v


class Context(BaseModel):
    class Config:
        extra = Extra.allow

    def to_json(self):
        return self.json()

    @classmethod
    def from_json(cls, json_str: str):
        data = json.loads(json_str)
        return cls(**data)
