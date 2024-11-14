import os

DATABASE_MODE = os.environ.get("DATABASE_MODE", "v2")
POSTGRES_URI = os.environ.get("POSTGRES_URI")
MONGODB_URI = os.environ.get("MONGODB_URI")
