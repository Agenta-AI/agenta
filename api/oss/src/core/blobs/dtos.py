from typing import Optional
from uuid import UUID

from oss.src.core.shared.dtos import Identifier, Slug, Data


class Blob(Identifier, Slug):
    data: Optional[Data] = None

    set_id: Optional[UUID] = None
