import logging

from sqlalchemy import inspect


# Initializer logger
logger = logging.getLogger('alembic.env')


def is_initial_setup(engine) -> bool:
    """
    Check if the database is in its initial state by verifying the existence of required tables.
    
    This function inspects the current state of the database and determines if it needs initial setup by checking for the presence of a predefined set of required tables.

    Args:
        engine (sqlalchemy.engine.base.Engine): The SQLAlchemy engine used to connect to the database.
    
    Returns:
        bool: True if the database is in its initial state (i.e., not all required tables exist), False otherwise.
    """

    inspector = inspect(engine)
    required_tables = [
        "users",
        "app_db",
        "deployments",
        "bases",
        "app_variants",
        "ids_mapping"
    ] # NOTE: The tables here were picked at random. Having all the tables in the database in the list \
     # will not change the behaviour of this function, so best to leave things as it is!
    existing_tables = inspector.get_table_names()

    # Check if all required tables exist in the database
    all_tables_exist = all(table in existing_tables for table in required_tables)

     # Log the status of the tables
    logger.info(f"Required tables: {required_tables}")
    logger.info(f"Existing tables: {existing_tables}")
    logger.info(f"All tables exist: {all_tables_exist}")

    return not all_tables_exist
