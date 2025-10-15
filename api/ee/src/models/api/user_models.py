from typing import List

from pydantic import Field

from oss.src.models.api.user_models import User


class User_(User):
    organizations: List[str] = Field(default_factory=list)
