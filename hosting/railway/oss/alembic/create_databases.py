import os
import subprocess
import time
from urllib.parse import urlparse


TARGET_DATABASES = (
    "agenta_oss_core",
    "agenta_oss_tracing",
    "agenta_oss_supertokens",
)


def parse_postgres_uri(uri: str) -> dict:
    parsed = urlparse(uri)

    if parsed.scheme not in {"postgresql", "postgresql+asyncpg"}:
        raise ValueError(f"Unsupported postgres URI scheme: {parsed.scheme}")

    if not parsed.hostname or not parsed.username:
        raise ValueError("Postgres URI is missing hostname or username")

    return {
        "host": parsed.hostname,
        "port": parsed.port or 5432,
        "user": parsed.username,
        "password": parsed.password,
    }


def run_psql(*, conn_args: dict, database: str, sql: str) -> str:
    env = os.environ.copy()
    if conn_args.get("password"):
        env["PGPASSWORD"] = conn_args["password"]

    cmd = [
        "psql",
        "-h",
        conn_args["host"],
        "-p",
        str(conn_args["port"]),
        "-U",
        conn_args["user"],
        "-d",
        database,
        "-tAc",
        sql,
    ]

    return subprocess.check_output(cmd, text=True, env=env).strip()


def ensure_databases() -> None:
    uri = (
        os.getenv("POSTGRES_URI_CORE")
        or os.getenv("POSTGRES_URI_SUPERTOKENS")
        or os.getenv("POSTGRES_URI_TRACING")
    )

    if not uri:
        raise RuntimeError(
            "Missing POSTGRES_URI_CORE/POSTGRES_URI_SUPERTOKENS/POSTGRES_URI_TRACING"
        )

    conn_args = parse_postgres_uri(uri)

    admin_db = None
    last_error = None
    for _ in range(60):
        for candidate in ("postgres", "railway", "template1"):
            try:
                run_psql(conn_args=conn_args, database=candidate, sql="SELECT 1")
                admin_db = candidate
                break
            except Exception as e:
                last_error = e

        if admin_db is not None:
            break

        time.sleep(2)

    if admin_db is None:
        raise RuntimeError(f"Unable to connect to an admin database: {last_error}")

    for db_name in TARGET_DATABASES:
        exists = ""
        for _ in range(30):
            try:
                exists = run_psql(
                    conn_args=conn_args,
                    database=admin_db,
                    sql=f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'",
                )
                break
            except Exception:
                time.sleep(2)

        if exists == "1":
            print(f"exists:{db_name}")
            continue

        run_psql(
            conn_args=conn_args,
            database=admin_db,
            sql=f'CREATE DATABASE "{db_name}"',
        )
        print(f"created:{db_name}")


if __name__ == "__main__":
    ensure_databases()
