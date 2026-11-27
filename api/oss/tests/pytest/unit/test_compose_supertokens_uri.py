"""Every compose SuperTokens service defaults to the bundled Postgres database.

An empty POSTGRESQL_CONNECTION_URI makes supertokens/supertokens-postgresql:11
use an in-memory database. Recreating the container then drops every account.
The `:-` fallback applies when POSTGRES_URI_SUPERTOKENS is unset or empty, and
a set value still overrides it. A POSTGRESQL_CONNECTION_URI in the env file is
kept next, then the bundled database with the postgres service's credentials.
The database name is the one init-db creates.
"""

import re
from pathlib import Path

import yaml

_REPO = Path(__file__).resolve().parents[5]
_COMPOSE = _REPO / "hosting" / "docker-compose"
_EDITIONS = ("oss", "ee")
# These are the files that shipped a supertokens service when the in-memory
# default was fixed. A new compose file with that service is checked too.
_REQUIRED = {
    "oss/docker-compose.dev.yml",
    "oss/docker-compose.gh.yml",
    "oss/docker-compose.gh.local.yml",
    "oss/docker-compose.gh.ssl.yml",
    "ee/docker-compose.dev.yml",
    "ee/docker-compose.gh.yml",
    "ee/docker-compose.gh.local.yml",
}
# run.sh auto-includes gitignored docker-compose.<stage>.<name>.local.yml
# overrides. Compose merges them over the base file, so they are not standalone.
_LOCAL_OVERRIDE = re.compile(r"docker-compose\.[^.]+\.[^.]+\.local\.yml")


def _supertokens_database(edition: str) -> str:
    sql_path = (
        _REPO / "api" / edition / "databases" / "postgres" / f"init-db-{edition}.sql"
    )
    names = re.findall(r"CREATE DATABASE\s+(\w*supertokens)\b", sql_path.read_text())
    expected = f"agenta_{edition}_supertokens"
    assert names == [expected], (sql_path, names)
    return expected


def test_supertokens_services_default_to_the_bundled_postgres_database():
    found = {}
    for edition in _EDITIONS:
        for path in sorted((_COMPOSE / edition).glob("docker-compose.*.yml")):
            if _LOCAL_OVERRIDE.fullmatch(path.name):
                continue
            document = yaml.safe_load(path.read_text())
            service = (document.get("services") or {}).get("supertokens")
            if not isinstance(service, dict):
                continue
            found[f"{edition}/{path.name}"] = service.get("environment")

    missing = _REQUIRED - set(found)
    assert not missing, sorted(missing)

    for relative, environment in sorted(found.items()):
        edition = relative.split("/", 1)[0]
        database = _supertokens_database(edition)
        expected = (
            "${POSTGRES_URI_SUPERTOKENS:-${POSTGRESQL_CONNECTION_URI:-"
            "postgresql://${POSTGRES_USER:-username}:${POSTGRES_PASSWORD:-password}"
            f"@postgres:5432/{database}}}}}"
        )
        assert isinstance(environment, dict), relative
        assert environment.get("POSTGRESQL_CONNECTION_URI") == expected, relative
