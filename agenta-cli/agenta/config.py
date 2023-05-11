from pydantic import BaseSettings

import os
import toml
from pathlib import Path
# Load the settings from the .toml file
toml_config = toml.load(f"{Path(__file__).parent}/config.toml")

# Set the environment variables from the TOML configurations
os.environ["DOCKER_REGISTRY_URL"] = toml_config["docker_registry_url"]
os.environ["DATABASE_URL"] = toml_config["database_url"]
os.environ["REGISTRY"] = toml_config["registry"]


class Settings(BaseSettings):
    docker_registry_url: str
    database_url: str
    registry: str


settings = Settings()
