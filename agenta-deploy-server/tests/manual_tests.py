import os
import docker
from deploy_server.config import settings

from deploy_server.services.docker_utils import list_images, start_container, stop_container, delete_container
from deploy_server.services.db_manager import add_app_variant, list_app_variants, get_image
from deploy_server.models.api_models import AppVariant, Image, URI
client = docker.from_env()
app_variant = AppVariant(app_name="test_app", variant_name="v1")
image = Image(docker_id="test_id", tags="test_tag")
add_app_variant(app_variant, image)
print(list_app_variants())
