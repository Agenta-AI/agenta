"""File-security and round-trip tests for ProviderCredentialFileStore.

Keys are obviously fake strings; no real credential ever appears here.
"""

import asyncio
import json
import os
import stat
from pathlib import Path

import pytest
from agenta_local.core.providers.dtos import ProviderCredential
from agenta_local.core.providers.types import (
    CredentialsFileCorrupt,
    CredentialsFileInsecure,
    ProviderNotConfigured,
)
from agenta_local.stores.files.providers import ProviderCredentialFileStore

FAKE_KEY = "sk-fake-0000-0000-0000"


@pytest.fixture
def store_path(tmp_path: Path) -> Path:
    return tmp_path / "providers.json"


@pytest.fixture
def store(store_path: Path) -> ProviderCredentialFileStore:
    return ProviderCredentialFileStore(store_path)


async def test_missing_file_reads_as_empty_store(store: ProviderCredentialFileStore):
    assert await store.list_states() == []
    with pytest.raises(ProviderNotConfigured):
        await store.get_for_execution(provider="openai")


async def test_put_get_delete_list_round_trip(
    store: ProviderCredentialFileStore, store_path: Path
):
    await store.put(
        provider="openai",
        credential=ProviderCredential(api_key=FAKE_KEY, base_url=None),
    )
    resolved = await store.get_for_execution(provider="openai")
    assert resolved.api_key == FAKE_KEY
    assert resolved.base_url is None

    states = await store.list_states()
    assert [s.provider for s in states] == ["openai"]
    assert states[0].configured is True

    await store.put(
        provider="anthropic",
        credential=ProviderCredential(
            api_key="sk-ant-fake-9999", base_url="https://example.invalid"
        ),
    )
    await store.delete(provider="openai")
    with pytest.raises(ProviderNotConfigured):
        await store.get_for_execution(provider="openai")
    assert [s.provider for s in await store.list_states()] == ["anthropic"]

    document = json.loads(store_path.read_text())
    assert document["version"] == 1
    assert set(document["providers"]) == {"anthropic"}


async def test_put_overwrites_existing_provider_key(
    store: ProviderCredentialFileStore,
):
    await store.put(provider="openai", credential=ProviderCredential(api_key=FAKE_KEY))
    rotated = "sk-fake-aaaa-bbbb-cccc"
    await store.put(provider="openai", credential=ProviderCredential(api_key=rotated))
    assert (await store.get_for_execution(provider="openai")).api_key == rotated


async def test_created_file_and_directory_have_private_modes(
    store: ProviderCredentialFileStore, store_path: Path, tmp_path: Path
):
    await store.put(provider="openai", credential=ProviderCredential(api_key=FAKE_KEY))
    assert stat.S_IMODE(os.stat(store_path).st_mode) == 0o600
    parent = store_path.parent
    if parent != tmp_path:
        assert stat.S_IMODE(os.stat(parent).st_mode) == 0o700
    # No temporary residue survives a successful write.
    assert [p.name for p in parent.iterdir() if p.name != store_path.name] == []


async def test_symlink_at_target_is_refused_and_victim_untouched(
    store_path: Path,
):
    victim = store_path.parent / "victim.txt"
    victim.write_text("do not touch")
    os.symlink(victim, store_path)

    store = ProviderCredentialFileStore(store_path)
    with pytest.raises(CredentialsFileInsecure):
        await store.list_states()
    with pytest.raises(CredentialsFileInsecure):
        await store.put(
            provider="openai", credential=ProviderCredential(api_key=FAKE_KEY)
        )
    with pytest.raises(CredentialsFileInsecure):
        await store.delete(provider="openai")
    assert victim.read_text() == "do not touch"
    assert store_path.is_symlink()


async def test_loose_permissions_are_refused_not_repaired(
    store: ProviderCredentialFileStore, store_path: Path
):
    await store.put(provider="openai", credential=ProviderCredential(api_key=FAKE_KEY))
    os.chmod(store_path, 0o644)
    with pytest.raises(CredentialsFileInsecure):
        await store.list_states()
    with pytest.raises(CredentialsFileInsecure):
        await store.get_for_execution(provider="openai")
    assert stat.S_IMODE(os.stat(store_path).st_mode) == 0o644  # left as found


async def test_corrupt_json_raises_typed_error(
    store: ProviderCredentialFileStore, store_path: Path
):
    store_path.write_text("{not json at all")
    os.chmod(store_path, 0o600)
    with pytest.raises(CredentialsFileCorrupt):
        await store.list_states()
    with pytest.raises(CredentialsFileCorrupt):
        await store.put(
            provider="openai", credential=ProviderCredential(api_key=FAKE_KEY)
        )


async def test_invalid_utf8_payload_raises_typed_error(
    store: ProviderCredentialFileStore, store_path: Path
):
    store_path.write_bytes(b"\xff\xfe\x00not-utf8")
    os.chmod(store_path, 0o600)
    with pytest.raises(CredentialsFileCorrupt):
        await store.list_states()


async def test_tampered_base_url_type_raises_typed_error(
    store: ProviderCredentialFileStore, store_path: Path
):
    store_path.write_text(
        json.dumps(
            {
                "version": 1,
                "providers": {"openai": {"api_key": FAKE_KEY, "base_url": 42}},
            }
        )
    )
    os.chmod(store_path, 0o600)
    with pytest.raises(CredentialsFileCorrupt):
        await store.list_states()
    with pytest.raises(CredentialsFileCorrupt):
        await store.get_for_execution(provider="openai")


async def test_unsupported_version_raises_typed_error(
    store: ProviderCredentialFileStore, store_path: Path
):
    store_path.write_text(json.dumps({"version": 99, "providers": {}}))
    os.chmod(store_path, 0o600)
    with pytest.raises(CredentialsFileCorrupt):
        await store.list_states()


async def test_empty_file_reads_as_empty_store(
    store: ProviderCredentialFileStore, store_path: Path
):
    store_path.write_text("")
    os.chmod(store_path, 0o600)
    assert await store.list_states() == []


async def test_concurrent_writers_produce_valid_complete_file(
    store: ProviderCredentialFileStore, store_path: Path
):
    providers = [f"provider-{index:02d}" for index in range(10)]

    async def write_one(name: str) -> None:
        await store.put(
            provider=name,
            credential=ProviderCredential(api_key=f"{FAKE_KEY}-{name}"),
        )

    await asyncio.gather(*(write_one(name) for name in providers))

    document = json.loads(store_path.read_text())  # valid JSON, no torn write
    assert set(document["providers"]) == set(providers)
    assert len(await store.list_states()) == 10


async def test_failed_write_leaves_no_temporary_residue(
    store: ProviderCredentialFileStore,
    store_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    await store.put(provider="openai", credential=ProviderCredential(api_key=FAKE_KEY))
    original_replace = os.replace

    def exploding_replace(src, dst):
        raise OSError("simulated crash before replace")

    monkeypatch.setattr(
        "agenta_local.stores.files.providers.os.replace", exploding_replace
    )
    with pytest.raises(OSError):
        await store.put(
            provider="anthropic",
            credential=ProviderCredential(api_key="sk-fake-dddd-eeee"),
        )
    monkeypatch.setattr(
        "agenta_local.stores.files.providers.os.replace", original_replace
    )

    residue = [p.name for p in store_path.parent.iterdir() if p.name.endswith(".tmp")]
    assert residue == []
    # Original entry intact.
    assert (await store.get_for_execution(provider="openai")).api_key == FAKE_KEY
