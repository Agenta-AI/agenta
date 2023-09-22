import os
from typing import Any, Dict, Union
from agenta_backend.models.api.user_models import User
from agenta_backend.models.api.organization_models import Organization
from agenta_backend.services.user_service import create_new_user
from agenta_backend.ee.services.organization_service import (
    create_new_organization,
)
from agenta_backend.config import settings

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    import agenta_backend.ee.__init__
