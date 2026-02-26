from typing import Optional

from pydantic import BaseModel


class ComposioToolConnectionData(BaseModel):
    connected_account_id: Optional[str] = None
    auth_config_id: Optional[str] = None
