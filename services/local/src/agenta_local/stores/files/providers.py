"""Provider credential file adapter (plan.md Slice 2 "Provider file adapter").

One versioned JSON file `{version, providers: {name: {api_key, base_url}}}`.
Security properties:

- File is created with mode 0600 and re-verified through fstat on every open
  (regular file, owned by the current user, no group/other bits). Unsafe files
  are refused, never silently repaired.
- Reads open with O_NOFOLLOW; a symlinked target raises CredentialsFileInsecure.
- Writes create a same-directory temporary file with O_EXCL|O_NOFOLLOW|0600,
  fsync it, os.replace onto the target, then fsync the parent directory.
- One asyncio lock serializes every read-modify-write within this store;
  composition roots must share a single instance process-wide.

Stdlib only. Blocking file work runs in a worker thread under the async lock.
"""

import asyncio
import errno
import json
import os
import secrets
import stat
from pathlib import Path

from ...core.providers.dtos import ProviderCredential, ProviderState
from ...core.providers.interfaces import ProviderCredentialsStoreInterface
from ...core.providers.types import (
    CredentialsFileCorrupt,
    CredentialsFileInsecure,
    ProviderNotConfigured,
    redact_key_suffix,
    validate_provider_name,
)

_FILE_VERSION = 1
_TMP_ATTEMPTS = 64
_READ_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
_WRITE_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
_DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)


def _load_payload(path: Path) -> dict[str, dict]:
    """Locked-file read shared by every operation. Missing file -> empty store."""
    try:
        fd = os.open(path, _READ_FLAGS)
    except FileNotFoundError:
        return {}
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise CredentialsFileInsecure(
                f"{path} is a symlink; refusing to follow"
            ) from exc
        raise
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise CredentialsFileCorrupt(f"{path} is not a regular file")
        if info.st_uid != os.getuid():
            raise CredentialsFileInsecure(
                f"{path} is owned by uid {info.st_uid}, not the current user"
            )
        if info.st_mode & 0o077:
            raise CredentialsFileInsecure(
                f"{path} has mode {stat.S_IMODE(info.st_mode):04o}; expected 0600"
            )
        payload = os.read(fd, max(info.st_size, 1))
    finally:
        os.close(fd)
    return _parse_payload(payload, path)


def _parse_payload(payload: bytes, path: Path) -> dict[str, dict]:
    """Validate the versioned envelope; any deviation is corruption."""
    try:
        text = payload.decode("utf-8")
        document = json.loads(text) if text.strip() else {}
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise CredentialsFileCorrupt(f"{path} is not valid UTF-8 JSON") from exc
    if document == {}:
        return {}
    if not isinstance(document, dict):
        raise CredentialsFileCorrupt(f"{path} must hold a JSON object")
    if document.get("version") != _FILE_VERSION:
        raise CredentialsFileCorrupt(
            f"{path}: unsupported file version {document.get('version')!r}"
        )
    providers = document.get("providers")
    if not isinstance(providers, dict):
        raise CredentialsFileCorrupt(f"{path}: 'providers' must be an object")
    for name, entry in providers.items():
        if not isinstance(name, str) or not isinstance(entry, dict):
            raise CredentialsFileCorrupt(f"{path}: malformed entry for {name!r}")
        if not isinstance(entry.get("api_key"), str):
            raise CredentialsFileCorrupt(f"{path}: missing api_key for {name!r}")
        if not isinstance(entry.get("base_url"), (str, type(None))):
            raise CredentialsFileCorrupt(f"{path}: invalid base_url for {name!r}")
    return providers


def _serialize_payload(providers: dict[str, dict]) -> bytes:
    return json.dumps({"version": _FILE_VERSION, "providers": providers}).encode()


def _fsync_directory(directory: Path) -> None:
    try:
        fd = os.open(directory, _DIR_FLAGS)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass  # best effort; some filesystems reject directory fsync
    finally:
        os.close(fd)


class ProviderCredentialFileStore(ProviderCredentialsStoreInterface):
    def __init__(self, path: Path) -> None:
        self._path = path
        self._directory = path.parent
        self._lock = asyncio.Lock()

    async def list_states(self) -> list[ProviderState]:
        async with self._lock:
            providers = await asyncio.to_thread(_load_payload, self._path)
        return [
            ProviderState(
                provider=name,
                configured=True,
                key_suffix=redact_key_suffix(str(entry["api_key"])),
            )
            for name, entry in sorted(providers.items())
        ]

    async def get_for_execution(self, *, provider: str) -> ProviderCredential:
        validate_provider_name(provider)
        async with self._lock:
            providers = await asyncio.to_thread(_load_payload, self._path)
        entry = providers.get(provider)
        if entry is None:
            raise ProviderNotConfigured(
                f"provider {provider!r} has no stored credentials"
            )
        return ProviderCredential(
            api_key=str(entry["api_key"]), base_url=entry.get("base_url")
        )

    async def put(self, *, provider: str, credential: ProviderCredential) -> None:
        validate_provider_name(provider)

        def mutate(current: dict[str, dict]) -> bool:
            current[provider] = {
                "api_key": credential.api_key,
                "base_url": credential.base_url,
            }
            return True

        await self._rewrite(mutate)

    async def delete(self, *, provider: str) -> None:
        validate_provider_name(provider)

        def mutate(current: dict[str, dict]) -> bool:
            current.pop(provider, None)
            return True

        await self._rewrite(mutate)

    async def _rewrite(self, mutate) -> None:
        """Serialized read-modify-write committed by one atomic replacement."""
        async with self._lock:
            await asyncio.to_thread(self._rewrite_locked, mutate)

    def _rewrite_locked(self, mutate) -> None:
        self._directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        providers = _load_payload(self._path)
        mutate(providers)
        payload = _serialize_payload(providers)

        tmp_path, fd = self._create_temp_file()
        replaced = False
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as handle:
                fd = -1  # ownership moved to handle
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, self._path)
            replaced = True
            _fsync_directory(self._directory)
        finally:
            if fd >= 0:
                os.close(fd)
            if not replaced:
                try:
                    os.unlink(tmp_path)
                except FileNotFoundError:
                    pass

    def _create_temp_file(self) -> tuple[Path, int]:
        """Random same-directory name opened exclusively, no-follow, mode 0600."""
        for _ in range(_TMP_ATTEMPTS):
            candidate = self._directory / (
                f".{self._path.name}.{secrets.token_hex(8)}.tmp"
            )
            try:
                return candidate, os.open(candidate, _WRITE_FLAGS, 0o600)
            except FileExistsError:
                continue
        raise RuntimeError(f"could not allocate a temporary file next to {self._path}")
