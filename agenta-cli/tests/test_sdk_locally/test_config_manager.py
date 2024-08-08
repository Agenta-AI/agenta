import json
from typing import Annotated

import agenta as ag
import pytest
import yaml
from agenta.sdk.config_manager import ConfigManager
from pydantic import BaseModel, Field
from unittest.mock import MagicMock, patch
from pathlib import Path


# AGENTA_MODE = TRUE
default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)


# To add to our types
# Option 1


class MyConfigSchema(BaseModel):  # <- the app
    prompt_template: str = Field(default=default_prompt)
    bool_param: bool = Field(default=True)
    int_param: int = Field(default=1, ge=1, le=5)
    float_param: float = Field(default=1.0, gt=0, lt=10)
    multiple: Annotated[str, ag.MultipleChoice(["gpt-3", "gpt-5"])] = Field(default="gpt3")
    # multiple: Literal["gpt-3", "gpt-5"] = Field(default="gpt-3")
    grouped_multiple: Annotated[str, ag.MultipleChoice({"openai": ["gpt-3", "gpt-5"], "azure": ["gpt-5", "gpt-3"]})] = Field(default="gpt3")

    class Settings:
        app_name: str = 'myapp'



@pytest.fixture
def sample_config():
    return {
        "prompt_template": "Custom prompt: {country} {gender}",
        "bool_param": False,
        "int_param": 3,
        "float_param": 5.5,
        "multiple": "gpt-5",
        "grouped_multiple": "gpt-5"
    }

@pytest.fixture
def yaml_config_file(tmp_path, sample_config):
    file_path = tmp_path / "test_config.yaml"
    with open(file_path, "w") as f:
        yaml.dump(sample_config, f)
    return file_path

@pytest.fixture
def json_config_file(tmp_path, sample_config):
    file_path = tmp_path / "test_config.json"
    with open(file_path, "w") as f:
        json.dump(sample_config, f)
    return file_path

def test_get_from_yaml(yaml_config_file):
    config = ConfigManager.get_from_yaml(str(yaml_config_file), MyConfigSchema)
    assert isinstance(config, MyConfigSchema)
    assert config.prompt_template == "Custom prompt: {country} {gender}"
    assert config.bool_param is False
    assert config.int_param == 3
    assert config.float_param == 5.5
    assert config.multiple == "gpt-5"
    assert config.grouped_multiple == "gpt-5"

def test_get_from_json(json_config_file):
    config = ConfigManager.get_from_json(str(json_config_file), MyConfigSchema)
    assert isinstance(config, MyConfigSchema)
    assert config.prompt_template == "Custom prompt: {country} {gender}"
    assert config.bool_param is False
    assert config.int_param == 3
    assert config.float_param == 5.5
    assert config.multiple == "gpt-5"
    assert config.grouped_multiple == "gpt-5"

def test_get_from_yaml_file_not_found():
    with pytest.raises(FileNotFoundError):
        ConfigManager.get_from_yaml("non_existent_file.yaml", MyConfigSchema)

def test_get_from_json_file_not_found():
    with pytest.raises(FileNotFoundError):
        ConfigManager.get_from_json("non_existent_file.json", MyConfigSchema)

