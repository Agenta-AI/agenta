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


class ChoiceMixin:
    """
    Provides a mixin for managing a list of choices.
    It is used as a base class for the MultipleChoiceParam class to \
        provide the functionality for handling the choices attribute.
    """

    def __init__(self, choices: List[str] = None):
        if not choices:
            raise ValueError("You must provide either a list of choices")
        self.choices = choices


class MultipleChoiceParam(str, ChoiceMixin):
    def __new__(cls, choices: List[str] = None):
        instance = super().__new__(cls, choices)
        instance.default = choices[0]
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
        if not messages:
            raise ValueError("Missing required parameter in MessagesInput")

        instance = super().__new__(cls, messages)
        instance.messages = messages
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
