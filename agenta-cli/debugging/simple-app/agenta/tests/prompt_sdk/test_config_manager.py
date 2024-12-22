import json
from typing import Annotated
from unittest.mock import patch

import yaml  # type: ignore
import pytest
from pydantic import BaseModel, Field

import agenta as ag
from agenta.tests.prompt_sdk.conftest import Parameters
from agenta.sdk.managers.config import ConfigManager


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
    multiple: Annotated[str, ag.MultipleChoice(["gpt-3", "gpt-5"])] = Field(
        default="gpt3"
    )
    # multiple: Literal["gpt-3", "gpt-5"] = Field(default="gpt-3")
    grouped_multiple: Annotated[
        str,
        ag.MultipleChoice({"openai": ["gpt-3", "gpt-5"], "azure": ["gpt-5", "gpt-3"]}),
    ] = Field(default="gpt3")

    class Settings:
        app_name: str = "myapp"


@pytest.fixture
def sample_config():
    return {
        "prompt_template": "Custom prompt: {country} {gender}",
        "bool_param": False,
        "int_param": 3,
        "float_param": 5.5,
        "multiple": "gpt-5",
        "grouped_multiple": "gpt-5",
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


@patch("agenta.ConfigManager.get_from_registry")
def test_fetch_configuration_and_return_dict(mock_get_config):
    # Mock the API response for fetching configuration

    mock_get_config.return_value = {
        "temperature": 0.9,
        "model": "gpt-3.5-turbo",
        "max_tokens": 100,
    }

    config = ConfigManager.get_from_registry(
        app_slug="my-app", variant_slug="new-variant", variant_version=2
    )

    assert isinstance(config, dict)
    assert config["temperature"] == 0.9
    assert config["model"] == "gpt-3.5-turbo"
    assert config["max_tokens"] == 100


@patch("agenta.ConfigManager.get_from_registry")
def test_fetch_configuration_and_return_schema(mock_get_config):
    # Mock the API response for fetching configuration

    mock_get_config.return_value = Parameters(
        temperature=0.9, model="gpt-3.5-turbo", max_tokens=100
    )

    config_as_schema = ConfigManager.get_from_registry(
        schema=Parameters,
        app_slug="my-app",
        variant_slug="new-variant",
        variant_version=2,
    )

    assert isinstance(config_as_schema, Parameters)
    assert config_as_schema.temperature == 0.9
    assert config_as_schema.model == "gpt-3.5-turbo"
    assert config_as_schema.max_tokens == 100


@pytest.mark.asyncio
@patch("agenta.ConfigManager.aget_from_registry")
async def test_afetch_configuration_and_return_dict(mock_aget_config):
    # Mock the API response for fetching configuration

    mock_aget_config.return_value = {
        "temperature": 0.9,
        "model": "gpt-3.5-turbo",
        "max_tokens": 100,
    }

    config = await ConfigManager.aget_from_registry(
        app_slug="my-app", variant_slug="new-variant", variant_version=2
    )

    assert config["temperature"] == 0.9
    assert config["model"] == "gpt-3.5-turbo"
    assert config["max_tokens"] == 100


@pytest.mark.asyncio
@patch("agenta.ConfigManager.aget_from_registry")
async def test_afetch_configuration_and_return_schema(mock_aget_config):
    # Mock the API response for fetching configuration

    mock_aget_config.return_value = Parameters(
        temperature=0.9, model="gpt-3.5-turbo", max_tokens=100
    )

    config_as_schema = await ConfigManager.aget_from_registry(
        schema=Parameters,
        app_slug="my-app",
        variant_slug="new-variant",
        variant_version=2,
    )

    assert isinstance(config_as_schema, Parameters)
    assert config_as_schema.temperature == 0.9
    assert config_as_schema.model == "gpt-3.5-turbo"
    assert config_as_schema.max_tokens == 100
