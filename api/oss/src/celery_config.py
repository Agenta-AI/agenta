from kombu import Exchange, Queue

from oss.src.utils.env import env


broker_url = env.CELERY_BROKER_URL
result_backend = env.CELERY_RESULT_BACKEND
task_serializer = "json"
accept_content = ["json"]
result_serializer = "json"
timezone = "UTC"
worker_hijack_root_logger = False
# CELERY_TASK_TRACK_STARTED = True

task_queues = (
    Queue(
        "src.tasks.evaluations.evaluate",
        Exchange("src.tasks.evaluations.evaluate"),
        routing_key="src.tasks.evaluations.evaluate",
    ),
    Queue(
        "src.tasks.evaluations.annotate",
        Exchange("src.tasks.evaluations.annotate"),
        routing_key="src.tasks.evaluations.annotate",
    ),
)
