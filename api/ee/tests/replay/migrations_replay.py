"""Replay the migration runner on real databases built by released images.

For each case it builds the databases with the migrations of a released image,
seeds organizations, members and projects, records which projects each member
can open, runs `ee.databases.postgres.migrations.runner` from this checkout, and
checks the version tables and the member access again.

Cases: a fresh database; open source databases built by v0.104.0 and v0.129.0;
a v0.104.0 open source database started with automatic migrations off; an EE database built by v0.129.0; an open source start interrupted during the
membership step; and a database below `park00000000`, which the runner must
refuse without a change.

It needs Docker and the git tag of the EE release (`git fetch origin tag
v0.129.0`). It starts its own Postgres container and removes it at the end.

    cd api
    uv run --no-sync python -m ee.tests.replay.migrations_replay
"""

import argparse
import os
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from alembic.script import ScriptDirectory

API_DIR = Path(__file__).resolve().parents[3]
REPO_DIR = API_DIR.parent
MIGRATIONS = API_DIR / "ee" / "databases" / "postgres" / "migrations"
OSS_MIGRATIONS = API_DIR / "oss" / "databases" / "postgres" / "migrations"

IMAGE = "ghcr.io/agenta-ai/agenta-api"
OSS_VERSIONS = ("v0.104.0", "v0.129.0")
EE_VERSION = "v0.129.0"
POSTGRES_IMAGE = "postgres:17"
USER = "username"
PASSWORD = "password"
PARK = "park00000000"

# Seed: two organizations. In A, u3 has a stale project row (editor, organization
# role viewer) and u5 has a project row but no organization row (no access in
# either edition). The EE seed restricts u2 to one project of A and gives u3 none.
U = {
    name: str(uuid.UUID(int=index + 1))
    for index, name in enumerate("u1 u2 u3 u4 u5".split())
}
ORG_A, ORG_B = str(uuid.UUID(int=101)), str(uuid.UUID(int=102))
WS_A, WS_B = str(uuid.UUID(int=201)), str(uuid.UUID(int=202))
P_A1, P_A2, P_B1 = (str(uuid.UUID(int=n)) for n in (301, 302, 303))


_PROJECTS = {ORG_A: {P_A1, P_A2}, ORG_B: {P_B1}}


def _in_org(access: set, organization_id: str) -> set:
    """Keep the "user project role" lines of one organization's projects."""

    return {line for line in access if line.split()[1] in _PROJECTS[organization_id]}


def _row_id() -> str:
    return str(uuid.uuid4())


def _seed_sql(edition: str) -> str:
    users = ",".join(f"('{i}', '{n}', '{n}', '{n}@replay.test')" for n, i in U.items())
    organization_members = [
        (U["u1"], ORG_A, "owner"),
        (U["u2"], ORG_A, "editor"),
        (U["u3"], ORG_A, "viewer"),
        (U["u2"], ORG_B, "owner"),
        (U["u4"], ORG_B, "admin"),
    ]
    if edition == "oss":
        project_members = [
            (U["u1"], P_A1, "owner"),
            (U["u3"], P_A1, "editor"),
            (U["u5"], P_A1, "viewer"),
            (U["u2"], P_B1, "owner"),
        ]
    else:
        project_members = [
            (U["u1"], P_A1, "owner"),
            (U["u1"], P_A2, "owner"),
            (U["u2"], P_A1, "editor"),
            (U["u5"], P_A1, "viewer"),
            (U["u2"], P_B1, "owner"),
            (U["u4"], P_B1, "admin"),
        ]
    sql = [
        f"INSERT INTO users (id, uid, username, email) VALUES {users};",
        "INSERT INTO organizations (id, name, owner_id) VALUES "
        f"('{ORG_A}', 'A', '{U['u1']}'), ('{ORG_B}', 'B', '{U['u2']}');",
        "INSERT INTO workspaces (id, name, type, organization_id) VALUES "
        f"('{WS_A}', 'A', 'default', '{ORG_A}'), ('{WS_B}', 'B', 'default', '{ORG_B}');",
        "INSERT INTO projects (id, project_name, is_default, workspace_id, organization_id)"
        f" VALUES ('{P_A1}', 'A1', true, '{WS_A}', '{ORG_A}'),"
        f" ('{P_A2}', 'A2', false, '{WS_A}', '{ORG_A}'),"
        f" ('{P_B1}', 'B1', true, '{WS_B}', '{ORG_B}');",
        "INSERT INTO organization_members (id, user_id, organization_id, role) VALUES "
        + ",".join(
            f"('{_row_id()}', '{u}', '{o}', '{r}')" for u, o, r in organization_members
        )
        + ";",
        "INSERT INTO workspace_members (id, user_id, workspace_id, role) VALUES "
        + ",".join(
            f"('{_row_id()}', '{u}', '{WS_A if o == ORG_A else WS_B}', '{r}')"
            for u, o, r in organization_members
        )
        + ";",
        "INSERT INTO project_members (id, user_id, project_id, role) VALUES "
        + ",".join(
            f"('{_row_id()}', '{u}', '{p}', '{r}')" for u, p, r in project_members
        )
        + ";",
    ]
    if edition == "ee":
        sql.append(
            "INSERT INTO subscriptions (plan, active, organization_id) VALUES "
            f"('self_hosted_enterprise', true, '{ORG_A}'),"
            f" ('self_hosted_enterprise', true, '{ORG_B}');"
        )
    return "\n".join(sql)


# The two membership policies of oss/src/dbs/postgres/memberships/dao.py: open
# source reads the organization row; EE needs the organization row and a project row.
_ACCESS_SQL = {
    "organization_wide": """
SELECT om.user_id || ' ' || p.id || ' ' || om.role
FROM (SELECT DISTINCT ON (user_id, organization_id) user_id, organization_id, role
      FROM organization_members
      ORDER BY user_id, organization_id, created_at ASC NULLS LAST, id ASC) om
JOIN projects p ON p.organization_id = om.organization_id
""",
    "project_rows": """
SELECT pm.user_id || ' ' || pm.project_id || ' ' || coalesce(pm.role, '')
FROM (SELECT DISTINCT ON (user_id, project_id) user_id, project_id, role
      FROM project_members WHERE user_id IS NOT NULL
      ORDER BY user_id, project_id, created_at ASC NULLS LAST, id ASC) pm
JOIN projects p ON p.id = pm.project_id
WHERE EXISTS (SELECT 1 FROM organization_members om
              WHERE om.user_id = pm.user_id AND om.organization_id = p.organization_id)
""",
}


def _head(directory: Path) -> str:
    return ScriptDirectory(str(directory)).get_current_head()


EXPECTED_HEADS = {
    "core": {
        "alembic_version": PARK,
        "alembic_version_oss": _head(OSS_MIGRATIONS / "core_oss"),
        "alembic_version_ee": _head(MIGRATIONS / "core_ee"),
    },
    "tracing": {
        "alembic_version": PARK,
        "alembic_version_oss": _head(OSS_MIGRATIONS / "tracing_oss"),
        "alembic_version_ee": _head(MIGRATIONS / "tracing_ee"),
    },
}


class Replay:
    def __init__(self, container: str, port: int, workdir: Path):
        self.container = container
        self.port = port
        self.workdir = workdir
        self.failures: list = []
        self.results: list = []

    # -- postgres ---------------------------------------------------------------

    def psql(self, database: str, sql: str) -> list:
        result = subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                self.container,
                "psql",
                "-U",
                USER,
                "-d",
                database,
                "-Atq",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            input=sql,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"psql on {database} failed: {result.stderr}")
        return [line for line in result.stdout.splitlines() if line]

    def databases(self) -> list:
        return sorted(
            self.psql(
                "postgres",
                "SELECT datname FROM pg_database WHERE datname LIKE 'agenta%';",
            )
        )

    def reset(self) -> None:
        for name in self.databases():
            self.psql("postgres", f"DROP DATABASE {name} WITH (FORCE);")

    def uris(self, prefix: str) -> dict:
        base = f"{USER}:{PASSWORD}@127.0.0.1:{self.port}"
        return {
            "POSTGRES_URI_CORE": f"postgresql+asyncpg://{base}/{prefix}_core",
            "POSTGRES_URI_TRACING": f"postgresql+asyncpg://{base}/{prefix}_tracing",
            "POSTGRES_URI_SUPERTOKENS": f"postgresql://{base}/{prefix}_supertokens",
        }

    def heads(self, database: str) -> dict:
        heads = {}
        for table in ("alembic_version", "alembic_version_oss", "alembic_version_ee"):
            exists = self.psql(
                database, f"SELECT to_regclass('public.{table}') IS NOT NULL;"
            )
            heads[table] = (
                ",".join(self.psql(database, f"SELECT version_num FROM {table};"))
                if exists == ["t"]
                else None
            )
        return heads

    def access(self, database: str, policy: str) -> set:
        return set(self.psql(database, _ACCESS_SQL[policy] + ";"))

    # -- migrations -------------------------------------------------------------

    def old_migrations(self, version: str, edition: str, ee_tree: Path = None) -> None:
        command = [
            "docker",
            "run",
            "--rm",
            "--network",
            "host",
            "-e",
            f"AGENTA_LICENSE={edition}",
        ]
        for key, value in self.uris(f"agenta_{edition}").items():
            command += ["-e", f"{key}={value}"]
        if ee_tree is not None:
            command += ["-v", f"{ee_tree}:/app/ee:ro"]
        command += [
            f"{IMAGE}:{version}",
            "python",
            "-m",
            f"{edition}.databases.postgres.migrations.runner",
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise RuntimeError(
                f"{version} {edition} migrations failed:\n{result.stdout}\n{result.stderr}"
            )

    def runner(
        self, edition: str, module: str, code: str = None, extra_env: dict = None
    ) -> subprocess.CompletedProcess:
        env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("POSTGRES_", "ALEMBIC_", "AGENTA_"))
        }
        env.update(self.uris(f"agenta_{edition}"))
        # An unchanged env file of that edition: AGENTA_LICENSE names the databases.
        env["AGENTA_LICENSE"] = edition
        env.update(extra_env or {})
        args = ["-c", code] if code else ["-m", module]
        result = subprocess.run(
            [sys.executable, *args],
            cwd=API_DIR,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        log = self.workdir / f"runner-{len(self.results)}-{time.monotonic_ns()}.log"
        log.write_text(result.stdout + "\n--- stderr ---\n" + result.stderr)
        return result

    # -- checks -----------------------------------------------------------------

    def check(self, case: str, condition: bool, message: str) -> None:
        self.results.append((case, condition, message))
        print(f"  [{'ok' if condition else 'FAIL'}] {message}")
        if not condition:
            self.failures.append(f"{case}: {message}")

    def check_heads(self, case: str, prefix: str) -> None:
        for kind in ("core", "tracing"):
            heads = self.heads(f"{prefix}_{kind}")
            self.check(
                case, heads == EXPECTED_HEADS[kind], f"{prefix}_{kind} heads {heads}"
            )

    def check_subscriptions(self, case: str, database: str) -> None:
        missing = self.psql(
            database,
            "SELECT id FROM organizations o WHERE NOT EXISTS "
            "(SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id);",
        )
        self.check(
            case,
            not missing,
            f"every organization has a subscription (missing: {missing})",
        )

    def check_no_other_edition_databases(self, case: str, edition: str) -> None:
        other = "ee" if edition == "oss" else "oss"
        created = [
            name for name in self.databases() if name.startswith(f"agenta_{other}")
        ]
        self.check(
            case, not created, f"no agenta_{other}_* databases created ({created})"
        )

    # -- cases ------------------------------------------------------------------

    def case_fresh(self) -> None:
        case = "fresh"
        print(f"\n== {case}")
        self.reset()
        result = self.runner("oss", "ee.databases.postgres.migrations.runner")
        self.check(
            case, result.returncode == 0, f"runner exit code {result.returncode}"
        )
        self.check_heads(case, "agenta_oss")
        self.check(
            case,
            self.psql(
                "agenta_oss_core",
                "SELECT to_regclass('public.subscriptions') IS NOT NULL;",
            )
            == ["t"],
            "the EE tables exist",
        )
        self.check_no_other_edition_databases(case, "oss")
        again = self.runner("oss", "ee.databases.postgres.migrations.runner")
        self.check(
            case, again.returncode == 0, f"second run exit code {again.returncode}"
        )
        self.check_heads(case, "agenta_oss")

    def _open_source_case(
        self, case: str, version: str, interrupt: bool = False
    ) -> None:
        print(f"\n== {case}")
        self.reset()
        self.old_migrations(version, "oss")
        core = "agenta_oss_core"
        self.check(
            case,
            self.heads(core)["alembic_version_ee"] is None,
            f"{version} database has no EE chain",
        )
        self.psql(core, _seed_sql("oss"))
        before = self.access(core, "organization_wide")

        if interrupt:
            code = (
                "import uuid\n"
                "import ee.databases.postgres.migrations.runner as runner\n"
                "real = runner.run_materialize\n"
                "async def interrupted():\n"
                f"    await real(organization_ids=[uuid.UUID('{ORG_A}')])\n"
                "    raise RuntimeError('replay: start interrupted during the membership step')\n"
                "runner.run_materialize = interrupted\n"
                "runner.main()\n"
            )
            seeded = self.access(core, "project_rows")
            result = self.runner("oss", None, code)
            self.check(
                case,
                result.returncode != 0
                and "start interrupted during the membership step" in result.stderr,
                f"interrupted run exit code {result.returncode}",
            )
            heads = self.heads(core)
            self.check(
                case, heads["alembic_version_ee"] is None, "core_ee did not start"
            )
            partial = self.access(core, "project_rows")
            self.check(
                case,
                _in_org(partial, ORG_A) == _in_org(before, ORG_A)
                and _in_org(partial, ORG_B) == _in_org(seeded, ORG_B)
                and _in_org(partial, ORG_B) != _in_org(before, ORG_B),
                "organization A written, organization B not yet",
            )

        # The old image's own module name, as old compose files call it.
        result = self.runner("oss", "oss.databases.postgres.migrations.runner")
        self.check(
            case, result.returncode == 0, f"runner exit code {result.returncode}"
        )
        self.check(
            case,
            "Project memberships written" in result.stdout,
            "the membership step ran",
        )
        self.check_heads(case, "agenta_oss")
        after = self.access(core, "project_rows")
        self.check(
            case, after == before, f"same access, same roles ({len(before)} pairs)"
        )
        self.check_subscriptions(case, core)
        self.check_no_other_edition_databases(case, "oss")

        rows = self.psql(core, "SELECT count(*) FROM project_members;")
        again = self.runner("oss", "oss.databases.postgres.migrations.runner")
        self.check(
            case, again.returncode == 0, f"second run exit code {again.returncode}"
        )
        self.check(
            case,
            "Project memberships written" not in again.stdout,
            "second run skips the membership step",
        )
        self.check(
            case,
            self.psql(core, "SELECT count(*) FROM project_members;") == rows,
            "second run writes no rows",
        )

    def case_open_source(self, version: str) -> None:
        self._open_source_case(f"oss {version}", version)

    def case_interrupted(self) -> None:
        self._open_source_case(
            f"oss {OSS_VERSIONS[-1]} interrupted", OSS_VERSIONS[-1], interrupt=True
        )

    def case_auto_migrations_off(self) -> None:
        version = OSS_VERSIONS[0]
        case = f"oss {version} with automatic migrations off"
        print(f"\n== {case}")
        self.reset()
        self.old_migrations(version, "oss")
        core = "agenta_oss_core"
        self.psql(core, _seed_sql("oss"))
        before = self.access(core, "organization_wide")
        rows_sql = "SELECT id || ' ' || coalesce(role, '') FROM project_members;"
        rows_before = set(self.psql(core, rows_sql))

        result = self.runner(
            "oss",
            "ee.databases.postgres.migrations.runner",
            extra_env={"ALEMBIC_AUTO_MIGRATIONS": "false"},
        )
        self.check(
            case, result.returncode == 0, f"runner exit code {result.returncode}"
        )
        self.check(
            case,
            "Project memberships written" not in result.stdout,
            "the membership step did not run",
        )
        self.check(
            case,
            self.heads(core)["alembic_version_ee"] is None,
            "core_ee did not run",
        )
        self.check(
            case,
            set(self.psql(core, rows_sql)) == rows_before,
            "no project row added or changed",
        )

        result = self.runner("oss", "ee.databases.postgres.migrations.runner")
        self.check(
            case,
            result.returncode == 0 and "Project memberships written" in result.stdout,
            f"a later run with automatic migrations adopts (exit {result.returncode})",
        )
        self.check_heads(case, "agenta_oss")
        self.check(
            case,
            self.access(core, "project_rows") == before,
            f"same access, same roles ({len(before)} pairs)",
        )

    def case_enterprise(self, ee_tree: Path) -> None:
        case = f"ee {EE_VERSION}"
        print(f"\n== {case}")
        self.reset()
        self.old_migrations(EE_VERSION, "ee", ee_tree)
        core = "agenta_ee_core"
        self.psql(core, _seed_sql("ee"))
        before = self.access(core, "project_rows")
        rows_before = set(
            self.psql(
                core, "SELECT id || ' ' || coalesce(role, '') FROM project_members;"
            )
        )

        result = self.runner("ee", "ee.databases.postgres.migrations.runner")
        self.check(
            case, result.returncode == 0, f"runner exit code {result.returncode}"
        )
        self.check(
            case,
            "Project memberships written" not in result.stdout,
            "the membership step did not run",
        )
        self.check_heads(case, "agenta_ee")
        self.check(
            case,
            self.access(core, "project_rows") == before,
            f"same access ({len(before)} pairs)",
        )
        rows_after = set(
            self.psql(
                core, "SELECT id || ' ' || coalesce(role, '') FROM project_members;"
            )
        )
        self.check(case, rows_after == rows_before, "no project row added or changed")
        self.check_subscriptions(case, core)
        self.check_no_other_edition_databases(case, "ee")

    def case_refused(self) -> None:
        case = "below park00000000"
        print(f"\n== {case}")
        self.reset()
        self.old_migrations(OSS_VERSIONS[0], "oss")
        core = "agenta_oss_core"
        # 4f5a6b7c8d9e is the open source revision right before park00000000.
        self.psql(core, "UPDATE alembic_version SET version_num = '4f5a6b7c8d9e';")
        tables_sql = (
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;"
        )
        tables, heads, databases = (
            self.psql(core, tables_sql),
            self.heads(core),
            self.databases(),
        )

        result = self.runner("oss", "oss.databases.postgres.migrations.runner")
        self.check(
            case, result.returncode != 0, f"runner exit code {result.returncode}"
        )
        self.check(
            case,
            "older than v0.104.0" in result.stderr and "4f5a6b7c8d9e" in result.stderr,
            "the log names the revision and the upgrade path",
        )
        self.check(case, self.psql(core, tables_sql) == tables, "no table changed")
        self.check(case, self.heads(core) == heads, "no version table changed")
        self.check(
            case, self.databases() == databases, "no database created or renamed"
        )


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--keep", action="store_true", help="Keep the Postgres container."
    )
    args = parser.parse_args()

    container = f"agenta-migrations-replay-{uuid.uuid4().hex[:8]}"
    port = _free_port()
    workdir = Path(tempfile.mkdtemp(prefix="agenta-migrations-replay-"))
    ee_tree = workdir / "ee"
    print(f"container {container} on port {port}; logs in {workdir}")

    archive = subprocess.run(
        ["git", "-C", str(REPO_DIR), "archive", EE_VERSION, "api/ee"],
        capture_output=True,
        check=True,
    )
    subprocess.run(["tar", "-x", "-C", str(workdir)], input=archive.stdout, check=True)
    (workdir / "api" / "ee").rename(ee_tree)

    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            container,
            "-e",
            f"POSTGRES_USER={USER}",
            "-e",
            f"POSTGRES_PASSWORD={PASSWORD}",
            "-p",
            f"127.0.0.1:{port}:5432",
            POSTGRES_IMAGE,
        ],
        check=True,
        capture_output=True,
    )
    replay = Replay(container, port, workdir)
    try:
        for _ in range(60):
            ready = subprocess.run(
                [
                    "docker",
                    "exec",
                    container,
                    "pg_isready",
                    "-U",
                    USER,
                    "-h",
                    "127.0.0.1",
                ],
                capture_output=True,
                check=False,
            )
            if ready.returncode == 0:
                break
            time.sleep(1)

        replay.case_fresh()
        for version in OSS_VERSIONS:
            replay.case_open_source(version)
        replay.case_auto_migrations_off()
        replay.case_enterprise(ee_tree)
        replay.case_interrupted()
        replay.case_refused()
    finally:
        if not args.keep:
            subprocess.run(
                ["docker", "rm", "-f", "-v", container],
                capture_output=True,
                check=False,
            )

    print()
    if replay.failures:
        print(f"{len(replay.failures)} check(s) failed:")
        for failure in replay.failures:
            print(f"  {failure}")
        return 1
    print(f"all {len(replay.results)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
