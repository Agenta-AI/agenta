import json
from typing import Dict, List, Optional

from pydantic import ConfigDict, BaseModel, HttpUrl


class InFile:
    def __init__(self, file_name: str, file_path: str):
        self.file_name = file_name
        self.file_path = file_path


class LLMTokenUsage(BaseModel):
    completion_tokens: int
    prompt_tokens: int
    total_tokens: int


class FuncResponse(BaseModel):
    message: str
    usage: Optional[LLMTokenUsage]
    cost: Optional[float]
    latency: float


class DictInput(dict):
    def __new__(cls, default_keys: Optional[List[str]] = None):
        instance = super().__new__(cls, default_keys)
        if default_keys is None:
            default_keys = []
        instance.data = [key for key in default_keys]  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "dict"}


class TextParam(str):
    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "text", "type": "string"}


class BinaryParam(int):
    def __new__(cls, value: bool = False):
        instance = super().__new__(cls, int(value))
        instance.default = value  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {
            "x-parameter": "bool",
            "type": "boolean",
        }


class IntParam(int):
    def __new__(cls, default: int = 6, minval: float = 1, maxval: float = 10):
        instance = super().__new__(cls, default)
        instance.minval = minval  # type: ignore
        instance.maxval = maxval  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "int", "type": "integer"}


class FloatParam(float):
    def __new__(cls, default: float = 0.5, minval: float = 0.0, maxval: float = 1.0):
        instance = super().__new__(cls, default)
        instance.default = default  # type: ignore
        instance.minval = minval  # type: ignore
        instance.maxval = maxval  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "float", "type": "number"}


class MultipleChoiceParam(str):
    def __new__(
        cls, default: Optional[str] = None, choices: Optional[List[str]] = None
    ):
        if default is not None and type(default) is list:
            raise ValueError(
                "The order of the parameters for MultipleChoiceParam is wrong! It's MultipleChoiceParam(default, choices) and not the opposite"
            )

        if not default and choices is not None:
            # if a default value is not provided,
            # set the first value in the choices list
            default = choices[0]

        if default is None and not choices:
            # raise error if no default value or choices is provided
            raise ValueError("You must provide either a default value or choices")

        instance = super().__new__(cls, default)
        instance.choices = choices  # type: ignore
        instance.default = default  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "choice", "type": "string", "enum": []}


class GroupedMultipleChoiceParam(str):
    def __new__(
        cls,
        default: Optional[str] = None,
        choices: Optional[Dict[str, List[str]]] = None,
    ):
        if choices is None:
            choices = {}
        if default and not any(
            default in choice_list for choice_list in choices.values()
        ):
            if not choices:
                print(
                    f"Warning: Default value {default} provided but choices are empty."
                )
            else:
                raise ValueError(
                    f"Default value {default} is not in the provided choices"
                )

        if not default:
            default_selected_choice = next(
                (choices for choices in choices.values()), None
            )
            if default_selected_choice:
                default = default_selected_choice[0]

        instance = super().__new__(cls, default)
        instance.choices = choices  # type: ignore
        instance.default = default  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {
            "x-parameter": "grouped_choice",
            "type": "string",
        }


class MessagesInput(list):
    """Messages Input for Chat-completion.

    Args:
        messages (List[Dict[str, str]]): The list of messages inputs.
        Required. Each message should be a dictionary with "role" and "content" keys.

    Raises:
        ValueError: If `messages` is not specified or empty.

    """

    def __new__(cls, messages: List[Dict[str, str]] = []):
        instance = super().__new__(cls)
        instance.default = messages  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "messages", "type": "array"}


class FileInputURL(HttpUrl):
    def __new__(cls, url: str):
        instance = super().__new__(cls, url)
        instance.default = url  # type: ignore
        return instance

    @classmethod
    def __schema_type_properties__(cls) -> dict:
        return {"x-parameter": "file_url", "type": "string"}


class Context(BaseModel):
    model_config = ConfigDict(extra="allow")

    def to_json(self):
        return self.model_dump()

    @classmethod
    def from_json(cls, json_str: str):
        data = json.loads(json_str)
        return cls(**data)
