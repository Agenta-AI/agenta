from pydantic import BaseSettings

import os
import toml
from typing import Optional

# Load the settings from the .toml file
toml_config = toml.load("agenta_backend/config.toml")

# Set the environment variables from the TOML configurations
os.environ["DOCKER_REGISTRY_URL"] = toml_config["docker_registry_url"]
os.environ["REGISTRY"] = toml_config["registry"]
os.environ["DATABASE_URL"] = toml_config["database_url"]
os.environ["DOCKER_HUB_URL"] = toml_config["docker_hub_url"]
os.environ["DOCKER_HUB_REPO_OWNER"] = toml_config["docker_hub_repo_owner"]
os.environ["DOCKER_HUB_REPO_NAME"] = toml_config["docker_hub_repo_name"]
os.environ["REDIS_URL"] = toml_config["redis_url"]
os.environ["FEATURE_FLAG"] = toml_config["feature_flag"]

if toml_config["feature_flag"] == "demo":
    os.environ["OPENAI_API_KEY"] = toml_config["openai_api_key"]

if toml_config["feature_flag"] == "cloud":
    os.environ["ECR_REPOSITORY"] = toml_config["ecr_repository"]
    os.environ["AWS_ACCESS_KEY_ID"] = toml_config["aws_access_key_id"]
    os.environ["AWS_SECRET_ACCESS_KEY"] = toml_config["aws_secret_access_key"]
    os.environ["AWS_REGION"] = toml_config["aws_region"]


class Settings(BaseSettings):
    docker_registry_url: str
    registry: str
    redis_url: str
    database_url: str
    docker_hub_url: str
    docker_hub_repo_owner: str
    docker_hub_repo_name: str
    feature_flag: str
    openai_api_key: Optional[str]
    ecr_repository: Optional[str]
    aws_secret_access_key: Optional[str]
    aws_access_key_id: Optional[str]
    aws_region: Optional[str]


settings = Settings()
