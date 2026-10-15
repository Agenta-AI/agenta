import json
from datetime import datetime

from oss.src.core.browser_profiles.dtos import (
    BrowserProfile,
    BrowserProfileState,
    BrowserSessionState,
)
from oss.src.dbs.postgres.secrets.dbes import SecretsDBE


def map_browser_login_dbe_to_dto(*, dbe: SecretsDBE) -> BrowserProfile:
    data = json.loads(dbe.data)  # type: ignore
    return BrowserProfile(
        id=dbe.id,  # type: ignore
        name=dbe.name,  # type: ignore
        allowed_hosts=data["allowed_hosts"],
        state=BrowserProfileState(data["state"]),
        generation=data["generation"],
        signed_in_at=(
            datetime.fromisoformat(data["signed_in_at"])
            if data.get("signed_in_at")
            else None
        ),
        created_at=dbe.created_at,  # type: ignore
        updated_at=dbe.updated_at,  # type: ignore
        created_by_id=dbe.created_by_id,  # type: ignore
    )


def map_browser_login_data_to_session_state(*, data: str) -> BrowserSessionState:
    decoded = json.loads(data)
    return BrowserSessionState(
        storage_state=decoded.get("storage_state"),
        generation=decoded["generation"],
    )
