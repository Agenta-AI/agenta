from pydantic import BaseSettings


class Settings(BaseSettings):
    docker_registry_url: str
    database_url: str


settings = Settings()
