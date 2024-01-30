import asyncio
from pymongo import MongoClient


async def drop_and_restore_collections(session=None):
    print("dropping and restoring collections")
    client = MongoClient("mongodb://username:password@mongo")
    backup_db_name = "agenta_v2_backup"
    main_db = "agenta_v2"
    agenta_v2_db = client[main_db]

    # Drop all collections in the agenta_v2 database
    for collection in agenta_v2_db.list_collection_names():
        agenta_v2_db[collection].drop()

    # Restore collections from agenta_v2_cloud_backup database
    backup_db = client[backup_db_name]
    for collection in backup_db.list_collection_names():
        data = list(backup_db[collection].find())
        if data:
            agenta_v2_db[collection].insert_many(data)

    client.close()


# Main entry point for the script
async def main():
    await drop_and_restore_collections()


# Run the main function
if __name__ == "__main__":
    asyncio.run(main())
