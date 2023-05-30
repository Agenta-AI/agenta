import os
import docker
from agenta_backend.config import settings

from agenta_backend.services import app_manager
from agenta_backend.services import db_manager
from agenta_backend.models.api.api_models import AppVariant, Image, URI

db_manager.print_all()
app_manager.remove_app("baby_name_generator")
# app = AppVariant(app_name="baby_name_generator", variant_name="v0")
# app_manager.remove_app_variant(app)
# app = AppVariant(app_name="baby_name_generator", variant_name="v0.2")
# app_manager.remove_app_variant(app)
