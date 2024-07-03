import os
from pymongo import MongoClient

# MongoDB connection
MONGO_URI = os.environ.get("MONGODB_URI")
DATABASE_MODE = os.environ.get("DATABASE_MODE")
mongo_client = MongoClient(MONGO_URI)
mongo_db_name = f"agenta_{DATABASE_MODE}"
mongo_db = mongo_client[mongo_db_name]


def get_mongo_db():
    return mongo_db
