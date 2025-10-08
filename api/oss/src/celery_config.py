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

TASK_NAMES = [
    "src.tasks.evaluations.legacy.annotate",
    "src.tasks.evaluations.live.evaluate",
    "src.tasks.evaluations.batch.evaluate_queries",
    "src.tasks.evaluations.batch.evaluate_testsets",
]

task_routes = {name: {"queue": name, "routing_key": name} for name in TASK_NAMES}

task_queues = [Queue(name, Exchange(name), routing_key=name) for name in TASK_NAMES]
