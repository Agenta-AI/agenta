import os
from pymongo import MongoClient
from agenta_backend.utils.common import isCloudEE

MONGO_URI_SRC = os.environ.get("MONGODB_URI")
MONGO_DATABASE_MODE = os.environ.get("DATABASE_MODE")
MONGO_DB_NAME_SRC = f"agenta_{MONGO_DATABASE_MODE}"


if isCloudEE():
    MONGO_URI_DEST = os.environ.get("MONGO_URI_DEST", None)
    MONGO_DEST_DATABASE_MODE = os.environ.get("MONGO_DEST_DATABASE_MODE", None)
    MONGO_DB_NAME_DEST = (
        f"agenta_{MONGO_DEST_DATABASE_MODE}" if MONGO_DEST_DATABASE_MODE else None
    )
    if not MONGO_URI_DEST and not MONGO_DB_NAME_DEST:
        mongo_client_dest = MongoClient(MONGO_URI_DEST)

mongo_client_src = MongoClient(MONGO_URI_SRC)


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
