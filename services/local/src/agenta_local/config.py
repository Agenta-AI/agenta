"""Local service configuration: env-overridable settings for one process."""

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(f"AGENTA_LOCAL_{name}", default)


def _optional_int(name: str) -> int | None:
    value = _env(name, "")
    return int(value) if value else None


@dataclass
class Settings:
    """Process-lifetime configuration; secrets never live here."""

    host: str = field(default_factory=lambda: _env("HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(_env("PORT", "8765")))
    data_dir: Path = field(
        default_factory=lambda: Path(
            _env("DATA_DIR", "~/.local/share/agenta-local")
        ).expanduser()
    )
    runner_url: str = field(
        default_factory=lambda: _env("RUNNER_URL", "http://127.0.0.1:8001")
    )
    static_dir: Path | None = field(
        default_factory=lambda: (
            Path(_env("STATIC_DIR", "")).expanduser()
            if _env("STATIC_DIR", "")
            else None
        )
    )
    migrations_dir: Path | None = field(
        default_factory=lambda: (
            Path(_env("MIGRATIONS_DIR", "")).expanduser()
            if _env("MIGRATIONS_DIR", "")
            else None
        )
    )
    browser_session: str | None = field(
        default_factory=lambda: _env("BROWSER_SESSION", "") or None
    )
    lock_fd: int | None = field(default_factory=lambda: _optional_int("LOCK_FD"))

    @property
    def database_path(self) -> Path:
        return self.data_dir / "local.db"

    @property
    def providers_path(self) -> Path:
        return self.data_dir / "providers.json"

    @property
    def lock_path(self) -> Path:
        return self.data_dir / "workspace.lock"

    @property
    def origin(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def host_header(self) -> str:
        return f"{self.host}:{self.port}"
