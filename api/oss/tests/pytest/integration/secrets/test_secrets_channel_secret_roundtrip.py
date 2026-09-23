"""A CHANNEL_SECRET round-trips through PGPString and never appears in a
read — the same discipline the four existing secret kinds already get,
extended to the one this wave adds.
"""

import pytest
from sqlalchemy import text

from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO

pytestmark = pytest.mark.integration

_BOT_TOKEN = "xoxb-integration-test-canary-do-not-echo"


async def test_channel_secret_roundtrips_and_stays_encrypted_at_rest(secrets_scope):
    service = VaultService(secrets_dao=SecretsDAO(engine=secrets_scope["engine"]))
    project_id = secrets_scope["project_id"]

    created = await service.create_secret(
        project_id=project_id,
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "slack-bot", "description": ""},
                "secret": {
                    "kind": "channel_secret",
                    "data": {
                        "kind": "slack",
                        "channel": {
                            "bot_token": _BOT_TOKEN,
                            "signing_secret": "sec",
                        },
                    },
                },
            }
        ),
    )

    fetched = await service.get_secret_by_id(
        secret_id=created.id, project_id=project_id
    )

    assert fetched is not None
    assert fetched.kind == "channel_secret"
    assert fetched.data.kind == "slack"
    assert fetched.data.channel.bot_token == _BOT_TOKEN

    # never appears in a read: the raw stored bytes are pgp_sym_encrypt
    # ciphertext, not the plaintext token — reading the column directly
    # (bypassing the ORM's decrypting TypeDecorator) must not find it.
    async with secrets_scope["engine"].session() as session:
        result = await session.execute(
            text("SELECT data FROM secrets WHERE id = :id"), {"id": created.id}
        )
        raw = result.scalar_one()

    assert _BOT_TOKEN.encode() not in bytes(raw)
