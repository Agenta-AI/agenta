from contextvars import ContextVar
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class Support(BaseModel):
    support_id: Optional[str] = None
    support_ts: Optional[datetime] = None


support_ctx: ContextVar[Optional[Support]] = ContextVar("support", default=None)
