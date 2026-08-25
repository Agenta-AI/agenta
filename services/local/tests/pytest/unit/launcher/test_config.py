from agenta_local.config import Settings


def test_env_configured_static_and_migrations_dirs_are_accepted(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENTA_LOCAL_STATIC_DIR", str(tmp_path / "web"))
    monkeypatch.setenv("AGENTA_LOCAL_MIGRATIONS_DIR", str(tmp_path / "migrations"))

    settings = Settings()

    assert settings.static_dir == tmp_path / "web"
    assert settings.migrations_dir == tmp_path / "migrations"


def test_unset_env_leaves_optional_dirs_none(monkeypatch):
    monkeypatch.delenv("AGENTA_LOCAL_STATIC_DIR", raising=False)
    monkeypatch.delenv("AGENTA_LOCAL_MIGRATIONS_DIR", raising=False)

    settings = Settings()

    assert settings.static_dir is None
    assert settings.migrations_dir is None
