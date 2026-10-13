import json
from uuid import UUID

from oss.src.core.browser_profiles.dtos import BrowserProfileState
from oss.src.core.secrets.enums import SecretKind
from oss.src.dbs.postgres.browser_profiles.dao import rebase_saved_state
from oss.src.dbs.postgres.browser_profiles.mappings import (
    map_browser_login_data_to_session_state,
    map_browser_login_dbe_to_dto,
)
from oss.src.dbs.postgres.secrets.dbes import SecretsDBE

LOGIN = UUID("00000000-0000-0000-0000-0000000000f1")
OWNER = UUID("00000000-0000-0000-0000-00000000000a")
DATA = {
    "allowed_hosts": ["github.com"],
    "state": "ready",
    "generation": 2,
    "storage_state": {"cookies": [{"name": "s", "value": "old"}]},
}


def test_a_save_under_the_current_generation_rebases_the_stored_state():
    seen = []

    def rebase(stored):
        seen.append(stored)
        return {"cookies": [{"name": "s", "value": "new"}]}

    assert rebase_saved_state(DATA, generation=2, rebase=rebase) == {
        "allowed_hosts": ["github.com"],
        "state": "ready",
        "generation": 2,
        "storage_state": {"cookies": [{"name": "s", "value": "new"}]},
    }
    # The rebase reads the row's own state, inside the same locked update.
    assert seen == [DATA["storage_state"]]


def test_a_save_from_a_browser_loaded_before_a_newer_login_is_refused():
    assert rebase_saved_state(DATA, generation=1, rebase=lambda _: {}) is None


def test_a_login_row_maps_to_a_profile_without_its_storage_state():
    dbe = SecretsDBE(
        id=LOGIN,
        kind=SecretKind.BROWSER_LOGIN,
        name="GitHub",
        data=json.dumps(DATA),
        created_by_id=OWNER,
    )

    profile = map_browser_login_dbe_to_dto(dbe=dbe)

    assert profile.model_dump(exclude={"created_at", "updated_at"}) == {
        "id": LOGIN,
        "name": "GitHub",
        "allowed_hosts": ["github.com"],
        "state": BrowserProfileState.READY,
        "generation": 2,
        "created_by_id": OWNER,
    }


def test_a_login_row_maps_to_its_session_state():
    state = map_browser_login_data_to_session_state(data=json.dumps(DATA))

    assert state.generation == 2
    assert state.storage_state == DATA["storage_state"]
