import os
from pymongo import MongoClient
from agenta_backend.utils.common import isCloudEE

MONGO_URI = os.environ.get("MONGODB_URI")
MONGO_DATABASE_MODE = os.environ.get("DATABASE_MODE")
MONGO_DB_NAME_SRC = f"agenta_{MONGO_DATABASE_MODE}"


if isCloudEE():
    MONGO_DB_NAME_DEST = os.environ.get("MONGO_DB_NAME_DEST", None)
    MONGO_DB_NAME_DEST = f"agenta_{MONGO_DB_NAME_DEST}" if MONGO_DB_NAME_DEST else None

    if MONGO_DB_NAME_DEST:
        mongo_client_dest = MongoClient(MONGO_URI)

mongo_client_src = MongoClient(MONGO_URI)


def get_mongo_db(mode):
    if mode.lower() == "src":
        return mongo_client_src[MONGO_DB_NAME_SRC]
    elif mode.lower() == "dest":
        return mongo_client_dest[MONGO_DB_NAME_DEST]
    else:
        raise ValueError("Invalid mode. Use 'src' or 'dest'.")


mongo_db = get_mongo_db("src")

if isCloudEE():
    mongo_db_dest = get_mongo_db("dest") if MONGO_DB_NAME_DEST else None
