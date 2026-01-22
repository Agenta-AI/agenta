from dotenv import load_dotenv
load_dotenv()

import app  # noqa: F401 - registers routes

from agenta import app as application
