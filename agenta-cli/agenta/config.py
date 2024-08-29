try:
    from pydantic.v1 import BaseSettings  # type: ignore
except ImportError:
    from pydantic import BaseSettings  # type: ignore

import os
import toml
from pathlib import Path

# Load the settings from the .toml file
toml_config = toml.load(f"{Path(__file__).parent}/config.toml")

# Set the environment variables from the TOML configurations
os.environ["REGISTRY"] = toml_config["registry"]
os.environ["BACKEND_URL_SUFFIX"] = toml_config["backend_url_suffix"]
os.environ["ALLOW_ORIGINS"] = toml_config["allow_origins"]


class Settings(BaseSettings):
    registry: str
    backend_url_suffix: str
    allow_origins: str


settings = Settings()
