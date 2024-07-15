import os
from pymongo import MongoClient
from agenta_backend.utils.common import isCloudEE

MONGO_URI = os.environ.get("MONGODB_URI")
db_src = f"agenta_{os.environ.get('MIGRATION_SRC_MONGO_DB_NAME')}"


if isCloudEE():
    db_dest = f"agenta_{os.environ.get('MIGRATION_DEST_MONGO_DB_NAME')}"

    if db_dest:
        mongo_client_dest = MongoClient(MONGO_URI)

mongo_client_src = MongoClient(MONGO_URI)


def get_mongo_db(mode):
    if mode.lower() == "src":
        return mongo_client_src[db_src]
    elif mode.lower() == "dest":
        return mongo_client_dest[db_dest]
    else:
        raise ValueError("Invalid mode. Use 'src' or 'dest'.")


mongo_db = get_mongo_db("src")

if isCloudEE():
    mongo_db_dest = get_mongo_db("dest") if db_dest else None
