"""Gunicorn config: JSON master and worker log lines when AGENTA_LOG_FORMAT=json.

Loaded with `GUNICORN_CMD_ARGS="--config python:entrypoints.gunicorn_conf"`, so the
gunicorn start lines (written before the app loads) use the same format.
"""

import os

if os.getenv("AGENTA_LOG_FORMAT", "text").strip().lower() == "json":
    from agenta.sdk.utils.logging import GOOGLE_CLOUD_PROJECT, gunicorn_logconfig

    logconfig_dict = gunicorn_logconfig("json", GOOGLE_CLOUD_PROJECT)
