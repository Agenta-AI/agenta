import os
import docker
from agenta_backend.config import settings

from agenta_backend.services.docker_utils import list_images, start_container, stop_container, delete_container
from agenta_backend.services.db_manager import add_app_variant, list_app_variants, get_image
from agenta_backend.models.api_models import AppVariant, Image, URI

client = docker.from_env()
uri = start_container("agenta-server/clitest", "clitest")

print(uri)
