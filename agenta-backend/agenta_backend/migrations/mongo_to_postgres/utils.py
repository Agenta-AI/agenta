import os
import asyncio
from datetime import datetime, timezone
from tqdm import tqdm

from pymongo import MongoClient
from bson import ObjectId, DBRef
from sqlalchemy import MetaData, Column, String, DateTime, text, create_engine
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import uuid_utils.compat as uuid
from sqlalchemy.future import select

from agenta_backend.models.db_engine import db_engine

from agenta_backend.models.db_models import (
    IDsMappingDB,
    Base,
)

BATCH_SIZE = 1000

# MongoDB connection
MONGO_URI = os.environ.get("MONGODB_URI")
DATABASE_MODE = os.environ.get("DATABASE_MODE")
mongo_client = MongoClient(MONGO_URI)
mongo_db_name = f"agenta_{DATABASE_MODE}"
mongo_db = mongo_client[mongo_db_name]

migration_report = {}


async def drop_all_tables():
    """Drop all tables in the database."""
    async with db_engine.engine.begin() as conn:
        await conn.run_sync(Base.metadata.reflect)
        # Drop all tables with CASCADE option
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(text(f"DROP TABLE IF EXISTS {table.name} CASCADE"))
    print("\n====================== All tables are dropped.\n")


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
    async with db_engine.get_session() as session:
        mapping = IDsMappingDB(
            id=id_, table_name=table_name, objectid=str(mongo_id), uuid=uuid
        )
        session.add(mapping)
        await session.commit()


async def get_mapped_uuid(table_name, mongo_id):
    """Retrieve the mapped UUID for a given MongoDB ObjectId and table name."""
    async with db_engine.get_session() as session:
        stmt = select(IDsMappingDB.uuid).filter(
            IDsMappingDB.table_name == table_name,
            IDsMappingDB.objectid == str(mongo_id),
        )
        result = await session.execute(stmt)
        row = result.first()
        return row[0] if row else None


def get_datetime(value):
    """Helper function to handle datetime fields."""
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value if value else datetime.now(timezone.utc)


def generate_uuid():
    """Generate a new UUID."""
    return uuid.uuid7()


def update_migration_report(collection_name, total_docs, migrated_docs):
    migration_report[collection_name] = {"total": total_docs, "migrated": migrated_docs}


def print_migration_report():
    print(
        "\n ============================ Migration Report ============================"
    )

    # Headers
    headers = ["Table", "Total in MongoDB", "Migrated to PostgreSQL"]

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

    # Set the header and divider with appropriate padding
    table_header = f"| {headers[0].ljust(max_table_length)} | {headers[1].ljust(max_total_length)} | {headers[2].ljust(max_migrated_length)} |"
    table_divider = f"|{'-' * (max_table_length + 2)}|{'-' * (max_total_length + 2)}|{'-' * (max_migrated_length + 2)}|"

    print(table_header)
    print(table_divider)

    for table, counts in migration_report.items():
        table_row = f"| {table.ljust(max_table_length)} | {str(counts['total']).ljust(max_total_length)} | {str(counts['migrated']).ljust(max_migrated_length)} |"
        print(table_row)


async def migrate_collection(
    collection_name, model_class, transformation_func, association_model=None
):
    """General function to migrate a collection to a SQL table."""
    print(f"\n")
    total_docs = mongo_db[collection_name].count_documents({})
    migrated_docs = 0

    async with db_engine.get_session() as session:
        for skip in tqdm(
            range(0, total_docs, BATCH_SIZE),
            total=(total_docs - 1) // BATCH_SIZE + 1,
            desc=f"Migrating: {collection_name}",
        ):
            batch = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: list(
                    mongo_db[collection_name].find().skip(skip).limit(BATCH_SIZE)
                ),
            )
            for document in batch:
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

    update_migration_report(collection_name, total_docs, migrated_docs)
