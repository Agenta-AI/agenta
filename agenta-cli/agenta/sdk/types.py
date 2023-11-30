import json
from typing import Any, Dict, List

from pydantic import BaseModel, Extra


class InFile:
    def __init__(self, file_name: str, file_path: str):
        self.file_name = file_name
        self.file_path = file_path


class DictInput(dict):
    def __new__(cls, default_keys=None):
        instance = super().__new__(cls, default_keys)
        if default_keys is None:
            default_keys = []
        instance.data = [key for key in default_keys]
        return instance

    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update({"x-parameter": "dict"})


class TextParam(str):
    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update({"x-parameter": "text"})


class IntParam(int):
    def __new__(cls, default: int = 6, minval: float = 1, maxval: float = 10):
        instance = super().__new__(cls, default)
        instance.minval = minval
        instance.maxval = maxval
        return instance

    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update(
            {
                "x-parameter": "int",
                "type": "integer",
                "minimum": 1,
                "maximum": 10,
            }
        )


class FloatParam(float):
    def __new__(cls, default: float = 0.5, minval: float = 0.0, maxval: float = 1.0):
        instance = super().__new__(cls, default)
        instance.minval = minval
        instance.maxval = maxval
        return instance

    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update(
            {
                "x-parameter": "float",
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0,
            }
        )


class MultipleChoiceParam(str):
    def __new__(cls, default: str = None, choices: List[str] = None):
        if type(default) is list:
            raise ValueError(
                "The order of the parameters for MultipleChoiceParam is wrong! It's MultipleChoiceParam(default, choices) and not the opposite"
            )
        if default is None and choices:
            # if a default value is not provided,
            # uset the first value in the choices list
            default = choices[0]

        if default is None and not choices:
            # raise error if no default value or choices is provided
            raise ValueError("You must provide either a default value or choices")

        instance = super().__new__(cls, default)
        instance.choices = choices
        instance.default = default
        return instance

    @classmethod
    def __modify_schema__(cls, field_schema: dict[str, Any]):
        field_schema.update(
            {
                "x-parameter": "choice",
                "type": "string",
                "enum": [],
            }
        )


class Message(BaseModel):
    role: str
    content: str


class MessagesInput(list):
    """Messages Input for Chat-completion.

    Args:
        messages (List[Dict[str, str]]): The list of messages inputs.
        Required. Each message should be a dictionary with "role" and "content" keys.

    Raises:
        ValueError: If `messages` is not specified or empty.

    """

    def __new__(cls, messages: List[Dict[str, str]] = None):
        instance = super().__new__(cls, messages)
        instance.default = messages
        return instance

    @classmethod
    def __modify_schema__(cls, field_schema: dict[str, Any]):
        field_schema.update({"x-parameter": "messages", "type": "array"})


class Context(BaseModel):
    class Config:
        extra = Extra.allow

    def to_json(self):
        return self.json()

    @classmethod
    def from_json(cls, json_str: str):
        data = json.loads(json_str)
        return cls(**data)
