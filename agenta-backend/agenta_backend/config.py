from pydantic import BaseSettings

import os
import toml

# Load the settings from the .toml file
toml_config = toml.load("agenta_backend/config.toml")

# Set the environment variables from the TOML configurations
os.environ["ENVIRONMENT"] = toml_config.get("environment", "development")
os.environ["DOCKER_REGISTRY_URL"] = toml_config["docker_registry_url"]
os.environ["REGISTRY"] = toml_config["registry"]
os.environ["DATABASE_URL"] = toml_config["database_url"]


class Settings(BaseSettings):
    environment: str
    docker_registry_url: str
    registry: str
    database_url: str

settings = Settings()
