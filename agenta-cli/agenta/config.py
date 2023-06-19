from pydantic import BaseSettings

import os
import toml
from pathlib import Path
# Load the settings from the .toml file
toml_config = toml.load(f"{Path(__file__).parent}/config.toml")

# Set the environment variables from the TOML configurations
os.environ["DATABASE_URL"] = toml_config["database_url"]
os.environ["REGISTRY"] = toml_config["registry"]
os.environ["BACKEND_ENDPOINT"] = toml_config["backend_endpoint"]
os.environ["ALLOW_ORIGINS"] = toml_config["allow_origins"]


class Settings(BaseSettings):
    database_url: str
    registry: str
    backend_endpoint: str
    allow_origins: str


settings = Settings()
