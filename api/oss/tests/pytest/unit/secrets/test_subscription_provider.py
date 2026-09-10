"""The subscription_provider secret kind: defaults, model keys, redaction, and identity.

A subscription connection stores a harness login the browser must never read back, and a
pile of server-owned login state the browser must never reset by accident. These tests
cover both halves against the real DTOs, the real redaction, and the real postgres
mappings.
"""

from uuid import uuid4

import pytest

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretResponseDTO,
    SubscriptionProviderDTO,
    UpdateSecretDTO,
    subscription_provider_slug,
)
from oss.src.core.secrets.enums import (
    SUBSCRIPTION_PROVIDER_MODELS,
    SecretKind,
    SubscriptionLoginState,
    SubscriptionProviderKind,
)
from oss.src.core.secrets.redaction import (
    project_secret_response,
    redact_secret_response,
)
from oss.src.core.secrets.services import _resolve_update
from oss.src.dbs.postgres.secrets.mappings import (
    map_secrets_dbe_to_dto,
    map_secrets_dto_to_dbe,
    map_secrets_dto_to_dbe_update,
)


LOGIN = {
    "type": "oauth",
    "access": "access-token-value",
    "refresh": "refresh-token-value",
    "expires": 1789000000000,
    "accountId": "acct-1",
}


def _create(data: dict | None = None, name: str = "ChatGPT") -> CreateSecretDTO:
    return CreateSecretDTO.model_validate(
        {
            "header": {"name": name},
            "secret": {"kind": "subscription_provider", "data": data or {}},
        }
    )


def _response(data: dict, *, write_only: bool = True) -> SecretResponseDTO:
    return SecretResponseDTO.model_validate(
        {
            "id": uuid4(),
            "slug": "chatgpt",
            "kind": SecretKind.SUBSCRIPTION_PROVIDER.value,
            "data": data,
            "header": {"name": "ChatGPT"},
            "write_only": write_only,
        }
    )


class TestDefaultsAndValidation:
    def test_an_empty_payload_takes_the_provider_defaults(self):
        data = _create().secret.data

        assert isinstance(data, SubscriptionProviderDTO)
        assert data.provider == SubscriptionProviderKind.CHATGPT
        assert data.harnesses == ["pi_core"]
        assert (
            data.models
            == SUBSCRIPTION_PROVIDER_MODELS[SubscriptionProviderKind.CHATGPT]
        )
        assert data.login is None
        assert data.login_version == 0
        assert data.login_generation == 0
        assert data.login_state == SubscriptionLoginState.PENDING_LOGIN

    def test_an_explicit_empty_model_list_is_kept(self):
        data = _create({"models": []}).secret.data

        assert data.models == []

    def test_an_unknown_provider_is_refused(self):
        with pytest.raises(ValueError):
            _create({"provider": "grok"})

    def test_a_non_object_payload_is_refused(self):
        with pytest.raises(ValueError):
            CreateSecretDTO.model_validate(
                {
                    "header": {"name": "ChatGPT"},
                    "secret": {"kind": "subscription_provider", "data": "nope"},
                }
            )

    def test_the_slug_is_derived_from_the_name(self):
        assert subscription_provider_slug("ChatGPT") == "chatgpt"
        assert subscription_provider_slug("My ChatGPT!") == "my-chatgpt"
        assert subscription_provider_slug(None) == "chatgpt"

    def test_model_keys_are_provider_slug_over_model(self):
        secret = _response(_create().secret.data.model_dump())

        assert secret.data.model_keys[0] == "chatgpt/gpt-5.6-sol"
        assert len(secret.data.model_keys) == len(secret.data.models)


class TestRedaction:
    def test_a_browser_never_sees_the_login_or_the_attempt(self):
        secret = _response(
            {
                "login": LOGIN,
                "login_version": 3,
                "login_generation": 1,
                "login_state": "ready",
                "login_attempt": {"id": "att-1", "user_code": "ABCD-EFGH"},
            }
        )

        public = redact_secret_response(secret)

        assert public.data.login is None
        assert public.data.login_attempt is None
        assert public.data.login_version == 3
        assert public.data.login_generation == 1
        assert public.data.login_state == SubscriptionLoginState.READY
        assert public.value_status.configured is True
        # A login is not a string, so there is nothing to preview.
        assert public.value_status.preview is None

    def test_the_runtime_grant_reads_the_login(self):
        secret = _response({"login": LOGIN, "login_version": 1})

        revealed = project_secret_response(secret, reveal_write_only=True)

        assert revealed.data.login.access == LOGIN["access"]
        assert revealed.data.login.accountId == LOGIN["accountId"]

    def test_the_login_is_stripped_even_when_the_row_is_not_write_only(self):
        # A subscription has no readable form of its credential, so the flag cannot open it.
        secret = _response({"login": LOGIN}, write_only=False)

        public = redact_secret_response(secret)

        assert public.data.login is None

    def test_a_connection_with_no_login_reads_as_unconfigured(self):
        public = redact_secret_response(_response(_create().secret.data.model_dump()))

        assert public.value_status.configured is False


class TestKeepOnOmit:
    def test_a_rename_keeps_the_login_and_its_state(self):
        stored = _response(
            {
                "login": LOGIN,
                "login_version": 4,
                "login_generation": 2,
                "login_state": "ready",
                "login_attempt": {"id": "att-1"},
            }
        )
        # The browser edits from the redacted read, so its payload carries no login at all.
        requested = UpdateSecretDTO.model_validate(
            {
                "header": {"name": "Work ChatGPT"},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"models": ["gpt-5.5"]},
                },
            }
        )

        resolved = _resolve_update(stored, requested)

        assert resolved.secret.data.login.access == LOGIN["access"]
        assert resolved.secret.data.login_version == 4
        assert resolved.secret.data.login_generation == 2
        assert resolved.secret.data.login_state == SubscriptionLoginState.READY
        assert resolved.secret.data.login_attempt.id == "att-1"
        assert resolved.secret.data.models == ["gpt-5.5"]

    def test_an_explicit_null_attempt_is_a_real_clear(self):
        stored = _response({"login": LOGIN, "login_attempt": {"id": "att-1"}})
        requested = UpdateSecretDTO.model_validate(
            {
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"login_attempt": None},
                },
            }
        )

        resolved = _resolve_update(stored, requested)

        assert resolved.secret.data.login_attempt is None
        assert resolved.secret.data.login.access == LOGIN["access"]


class TestPostgresRoundTrip:
    def test_the_login_survives_a_write_and_a_read(self):
        create = _create({"login": LOGIN, "login_state": "ready", "login_version": 1})
        dbe = map_secrets_dto_to_dbe(
            project_id=uuid4(),
            organization_id=None,
            secret_dto=create,
        )

        read_back = map_secrets_dbe_to_dto(secrets_dbe=dbe)

        assert read_back.kind == SecretKind.SUBSCRIPTION_PROVIDER
        assert read_back.data.login.refresh == LOGIN["refresh"]
        assert read_back.data.login_state == SubscriptionLoginState.READY
        assert read_back.write_only is True

    def test_an_update_persists_a_cleared_attempt(self):
        create = _create({"login": LOGIN, "login_attempt": {"id": "att-1"}})
        dbe = map_secrets_dto_to_dbe(
            project_id=uuid4(),
            organization_id=None,
            secret_dto=create,
        )

        update = UpdateSecretDTO.model_validate(
            {
                "secret": {
                    "kind": "subscription_provider",
                    "data": {
                        **map_secrets_dbe_to_dto(secrets_dbe=dbe).data.model_dump(
                            mode="json"
                        ),
                        "login_attempt": None,
                    },
                }
            }
        )
        map_secrets_dto_to_dbe_update(secrets_dbe=dbe, update_secret_dto=update)

        assert map_secrets_dbe_to_dto(secrets_dbe=dbe).data.login_attempt is None
