import os
import logging


# Configure and set logging level
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


# Environment variables
DATABASE_MODE = os.environ.get("DATABASE_MODE", "v2")
POSTGRES_URI = os.environ.get("POSTGRES_URI")
MONGODB_URI = os.environ.get("MONGODB_URI")
