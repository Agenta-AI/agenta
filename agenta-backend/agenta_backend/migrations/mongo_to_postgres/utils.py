import os
import asyncio
import asyncpg
from datetime import datetime, timezone
from tqdm import tqdm

from bson import ObjectId, DBRef
from sqlalchemy import MetaData, Column, String, DateTime, text, create_engine
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import uuid_utils.compat as uuid
from sqlalchemy.future import select
from sqlalchemy.exc import NoResultFound
from agenta_backend.migrations.mongo_to_postgres.db_engine import db_engine
from sqlalchemy.exc import IntegrityError, MultipleResultsFound

from agenta_backend.models.db_models import IDsMappingDB
from agenta_backend.models.base import Base
from agenta_backend.migrations.mongo_to_postgres.mongo_db_engine import mongo_db

from agenta_backend.dbs.postgres.shared.engine import engine

BATCH_SIZE = 1000


migration_report = {}


async def create_all_tables(tables):
    """Create all tables in the database."""
    async with db_engine.engine.begin() as conn:
        for table in tables:
            print(f"Creating table for {table.__name__}")
            await conn.run_sync(table.metadata.create_all)
    print("\n====================== All tables are created.\n")


async def store_mapping(table_name, mongo_id, uuid):
    """Store the mapping of MongoDB ObjectId to UUID in the mapping table."""
    id_ = generate_uuid()
    async with engine.session() as session:
        mapping = IDsMappingDB(
            id=id_, table_name=table_name, objectid=str(mongo_id), uuid=uuid
        )
        session.add(mapping)
        await session.commit()


async def get_mapped_uuid(table_name, mongo_id):
    """Retrieve the mapped UUID for a given MongoDB ObjectId and table name."""
    async with engine.session() as session:
        stmt = select(IDsMappingDB.uuid).filter(
            IDsMappingDB.table_name == table_name,
            IDsMappingDB.objectid == str(mongo_id),
        )
        result = await session.execute(stmt)
        try:
            row = result.one()
        except MultipleResultsFound:
            print(
                f"Multiple mappings found for {table_name} and {mongo_id}. Skipping..."
            )
            return None
        except NoResultFound:
            return None
        return row[0]


def get_datetime(value):
    """Helper function to handle datetime fields."""
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value if value else datetime.now(timezone.utc)


def generate_uuid():
    """Generate a new UUID."""
    return uuid.uuid7()


def update_migration_report(collection_name, total_docs, migrated_docs, skipped_docs):
    migration_report[collection_name] = {
        "total": total_docs,
        "migrated": migrated_docs,
        "skipped": skipped_docs,
    }


def print_migration_report():
    print(
        "\n ============================ Migration Report ============================"
    )

    # Headers
    headers = ["Table", "Total in MongoDB", "Migrated to PostgreSQL", "Skipped"]

    if not migration_report:
        print("No data available in the migration report.")
        return

    # Determine the maximum lengths for each column including headers
    max_table_length = max(
        len(headers[0]), max(len(table) for table in migration_report.keys())
    )
    max_total_length = max(
        len(headers[1]),
        max(len(str(counts["total"])) for counts in migration_report.values()),
    )
    max_migrated_length = max(
        len(headers[2]),
        max(len(str(counts["migrated"])) for counts in migration_report.values()),
    )
    max_skipped_length = max(
        len(headers[3]),
        max(len(str(counts.get("skipped", 0))) for counts in migration_report.values()),
    )

    # Set the header and divider with appropriate padding
    table_header = f"| {headers[0].ljust(max_table_length)} | {headers[1].ljust(max_total_length)} | {headers[2].ljust(max_migrated_length)} | {headers[3].ljust(max_skipped_length)} |"
    table_divider = f"|{'-' * (max_table_length + 2)}|{'-' * (max_total_length + 2)}|{'-' * (max_migrated_length + 2)}|{'-' * (max_skipped_length + 2)}|"

    print(table_header)
    print(table_divider)

    for table, counts in migration_report.items():
        skipped = counts.get("skipped", 0)
        table_row = f"| {table.ljust(max_table_length)} | {str(counts['total']).ljust(max_total_length)} | {str(counts['migrated']).ljust(max_migrated_length)} | {str(skipped).ljust(max_skipped_length)} |"
        print(table_row)

    print(table_divider)


async def migrate_collection(
    collection_name, model_class, transformation_func, association_model=None
):
    """General function to migrate a collection to a SQL table."""
    print(f"\n")
    total_docs = mongo_db[collection_name].count_documents({})
    migrated_docs = 0
    skipped_docs = 0

    async with engine.session() as session:
        for skip in tqdm(
            range(0, total_docs, BATCH_SIZE),
            total=(total_docs - 1) // BATCH_SIZE + 1,
            desc=f"Migrating: {collection_name}",
            ncols=85,
        ):
            batch = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: list(
                    mongo_db[collection_name].find().skip(skip).limit(BATCH_SIZE)
                ),
            )
            for document in batch:
                try:
                    if association_model:
                        (
                            transformed_document,
                            associated_entities,
                        ) = await transformation_func(document)
                        session.add(model_class(**transformed_document))
                        for assoc_entity in associated_entities:
                            session.add(association_model(**assoc_entity))
                    else:
                        transformed_document = await transformation_func(document)
                        session.add(model_class(**transformed_document))
                    await session.commit()
                    migrated_docs += 1
                except (asyncpg.exceptions.UniqueViolationError, IntegrityError) as e:
                    await session.rollback()
                    print(f"\nSkipping duplicate document in {collection_name}: {e}\n")
                    skipped_docs += 1
                    pass
                except Exception as e:
                    print(f"Error migrating document in {collection_name}: {e}")
                    print(f"Failing migration for collection: {collection_name}")
                    raise

    update_migration_report(collection_name, total_docs, migrated_docs, skipped_docs)
