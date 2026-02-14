import os
import subprocess
import tempfile

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from sqlalchemy.exc import ProgrammingError

from oss.src.utils.env import env


# Config (can override via env)
POSTGRES_URI = (
    os.getenv("POSTGRES_URI")
    or env.postgres.uri_core
    or env.postgres.uri_tracing
    or "postgresql+asyncpg://username:password@localhost:5432/agenta_oss"
)
DB_PROTOCOL = POSTGRES_URI.split("://")[0]  # .replace("+asyncpg", "")
DB_USER = POSTGRES_URI.split("://")[1].split(":")[0]
DB_PASS = POSTGRES_URI.split("://")[1].split(":")[1].split("@")[0]
DB_HOST = POSTGRES_URI.split("@")[1].split(":")[0]
DB_PORT = POSTGRES_URI.split(":")[-1].split("/")[0]
ADMIN_DB = "postgres"

POSTGRES_URI_POSTGRES = (
    f"{DB_PROTOCOL}://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{ADMIN_DB}"
)

# Rename/create map: {'old_name': 'new_name'}
RENAME_MAP = {
    "agenta_oss": "agenta_oss_core",
    "supertokens_oss": "agenta_oss_supertokens",
    "agenta_oss_tracing": "agenta_oss_tracing",
}


NODES_TF = {
    "agenta_oss_core": "agenta_oss_tracing",
}


async def copy_nodes_from_core_to_tracing():
    engine = create_async_engine(
        POSTGRES_URI_POSTGRES,
        isolation_level="AUTOCOMMIT",
    )

    async with engine.begin() as conn:
        for old_name, new_name in NODES_TF.items():
            old_exists = (
                await conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": old_name},
                )
            ).scalar()

            new_exists = (
                await conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": new_name},
                )
            ).scalar()

            if old_exists and new_exists:
                # Check if the nodes table exists in old_name database
                check_url = f"{DB_PROTOCOL}://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{old_name}"
                check_engine = create_async_engine(check_url)
                async with check_engine.begin() as conn:
                    result = (
                        await conn.execute(
                            text("SELECT to_regclass('public.nodes')"),
                        )
                    ).scalar()
                    if result is None:
                        print(
                            f"⚠️ Table 'nodes' does not exist in '{old_name}'. Skipping copy."
                        )
                        return

                    count = (
                        await conn.execute(
                            text("SELECT COUNT(*) FROM public.nodes"),
                        )
                    ).scalar()

                    if count == 0:
                        print(
                            f"⚠️ Table 'nodes' is empty in '{old_name}'. Skipping copy."
                        )
                        return

                check_url = f"{DB_PROTOCOL}://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{new_name}"
                check_engine = create_async_engine(check_url)

                async with check_engine.begin() as conn:
                    count = (
                        await conn.execute(
                            text(
                                "SELECT COUNT(*) FROM public.nodes",
                            )
                        )
                    ).scalar()

                    if (count or 0) > 0:
                        print(
                            f"⚠️ Table 'nodes' already exists in '{new_name}' with {count} rows. Skipping copy."
                        )
                        return

                with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as tmp:
                    dump_file = tmp.name

                try:
                    # Step 1: Dump the 'nodes' table to file
                    subprocess.run(
                        [
                            "pg_dump",
                            "-h",
                            DB_HOST,
                            "-p",
                            str(DB_PORT),
                            "-U",
                            DB_USER,
                            "-d",
                            old_name,
                            "-t",
                            "nodes",
                            "--format=custom",  # requires -f, not stdout redirection
                            "--no-owner",
                            "--no-privileges",
                            "-f",
                            dump_file,
                        ],
                        check=True,
                        env={**os.environ, "PGPASSWORD": DB_PASS},
                    )

                    print(f"✔ Dumped 'nodes' table to '{dump_file}'")

                    # Step 2: Restore the dump into the new database
                    subprocess.run(
                        [
                            "pg_restore",
                            "--data-only",
                            "--no-owner",
                            "--no-privileges",
                            "-h",
                            DB_HOST,
                            "-p",
                            str(DB_PORT),
                            "-U",
                            DB_USER,
                            "-d",
                            new_name,
                            dump_file,
                        ],
                        check=True,
                        env={**os.environ, "PGPASSWORD": DB_PASS},
                    )

                    print(f"✔ Restored 'nodes' table into '{new_name}'")

                    # Step 3: Verify 'nodes' exists in both DBs, then drop from old
                    source_engine = create_async_engine(
                        f"{DB_PROTOCOL}://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{old_name}"
                    )
                    dest_engine = create_async_engine(
                        f"{DB_PROTOCOL}://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{new_name}"
                    )

                    async with source_engine.begin() as src, dest_engine.begin() as dst:
                        src = await src.execution_options(isolation_level="AUTOCOMMIT")
                        dst = await dst.execution_options(isolation_level="AUTOCOMMIT")

                        src_exists = (
                            await src.execute(
                                text("SELECT to_regclass('public.nodes')")
                            )
                        ).scalar()
                        dst_exists = (
                            await dst.execute(
                                text("SELECT to_regclass('public.nodes')"),
                            )
                        ).scalar()

                        if src_exists and dst_exists:
                            subprocess.run(
                                [
                                    "psql",
                                    "-h",
                                    DB_HOST,
                                    "-p",
                                    str(DB_PORT),
                                    "-U",
                                    DB_USER,
                                    "-d",
                                    old_name,
                                    "-c",
                                    "TRUNCATE TABLE public.nodes CASCADE",
                                ],
                                check=True,
                                env={**os.environ, "PGPASSWORD": DB_PASS},
                            )

                            count = (
                                await src.execute(
                                    text("SELECT COUNT(*) FROM public.nodes"),
                                )
                            ).scalar()

                            print(f"✅ Remaining rows: {count}")

                except subprocess.CalledProcessError as e:
                    print(f"❌ pg_dump/psql failed: {e}")
                finally:
                    if os.path.exists(dump_file):
                        os.remove(dump_file)


async def split_core_and_tracing():
    engine = create_async_engine(
        POSTGRES_URI_POSTGRES,
        isolation_level="AUTOCOMMIT",
    )

    async with engine.begin() as conn:
        for old_name, new_name in RENAME_MAP.items():
            old_exists = (
                await conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": old_name},
                )
            ).scalar()

            new_exists = (
                await conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": new_name},
                )
            ).scalar()

            if old_exists and not new_exists:
                print(f"Renaming database '{old_name}' → '{new_name}'...")
                try:
                    await conn.execute(
                        text(f"ALTER DATABASE {old_name} RENAME TO {new_name}")
                    )
                    print(f"✔ Renamed '{old_name}' to '{new_name}'")
                except ProgrammingError as e:
                    print(f"❌ Failed to rename '{old_name}': {e}")

            elif not old_exists and new_exists:
                print(
                    f"'{old_name}' does not exist, but '{new_name}' already exists. No action taken."
                )

            elif not old_exists and not new_exists:
                print(
                    f"Neither '{old_name}' nor '{new_name}' exists. Creating '{new_name}'..."
                )
                try:
                    # Ensure the role exists
                    await conn.execute(
                        text(
                            f"""
                            DO $$
                            BEGIN
                                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{DB_USER}') THEN
                                    EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', '{DB_USER}', '{DB_PASS}');
                                END IF;
                            END
                            $$;
                            """
                        )
                    )
                    print(f"✔ Ensured role '{DB_USER}' exists")

                    # Create the new database
                    await conn.execute(text(f"CREATE DATABASE {new_name}"))
                    print(f"✔ Created database '{new_name}'")

                    # Grant privileges on the database to the role
                    await conn.execute(
                        text(
                            f"GRANT ALL PRIVILEGES ON DATABASE {new_name} TO {DB_USER}"
                        )
                    )
                    print(
                        f"✔ Granted privileges on database '{new_name}' to '{DB_USER}'"
                    )

                    # Connect to the new database to grant schema permissions
                    new_db_url = f"{DB_PROTOCOL}://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{new_name}"

                    async with create_async_engine(
                        new_db_url, isolation_level="AUTOCOMMIT"
                    ).begin() as new_db_conn:
                        await new_db_conn.execute(
                            text(f"GRANT ALL ON SCHEMA public TO {DB_USER}")
                        )
                        print(
                            f"✔ Granted privileges on schema 'public' in '{new_name}' to '{DB_USER}'"
                        )

                except ProgrammingError as e:
                    print(
                        f"❌ Failed during creation or configuration of '{new_name}': {e}"
                    )

            else:
                print(f"Both '{old_name}' and '{new_name}' exist. No action taken.")
