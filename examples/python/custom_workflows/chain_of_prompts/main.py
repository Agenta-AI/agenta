from dotenv import load_dotenv

load_dotenv()

import app  # noqa: F401, E402 - registers routes

from agenta import app as application  # noqa: F401, E402
