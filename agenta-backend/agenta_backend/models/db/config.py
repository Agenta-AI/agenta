import os
import logging


# Configure and set logging level
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


# Environment variables
POSTGRES_URL = os.environ.get("POSTGRES_URL")
