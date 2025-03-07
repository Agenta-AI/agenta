import os
from kombu import Exchange, Queue

BROKER_URL = os.getenv("CELERY_BROKER_URL")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND")
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"
CELERY_TASK_TRACK_STARTED = True

CELERY_QUEUES = (
    Queue(
        "src.tasks.evaluations.evaluate",
        Exchange("src.tasks.evaluations.evaluate"),
        routing_key="src.tasks.evaluations.evaluate",
    ),
)
