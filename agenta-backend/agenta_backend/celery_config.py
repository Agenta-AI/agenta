import os
from kombu import Exchange, Queue

# Use environment variables with default values as fallback
BROKER_URL = os.getenv('CELERY_BROKER_URL')
CELERY_RESULT_BACKEND = os.getenv('CELERY_RESULT_BACKEND')
CELERY_TASK_SERIALIZER = 'json'
CELERY_ACCEPT_CONTENT = ['json']
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'UTC'

# TODO: Can we improve this to be more dynamic?
CELERY_QUEUES = (
    Queue('agenta_backend.tasks.evaluations.auto_exact_match',
          Exchange('agenta_backend.tasks.evaluations.auto_exact_match'),
          routing_key='agenta_backend.tasks.evaluations.auto_exact_match'),
    Queue('agenta_backend.tasks.evaluations.auto_similarity_match',
          Exchange('agenta_backend.tasks.evaluations.auto_similarity_match'),
          routing_key='agenta_backend.tasks.evaluations.auto_similarity_match'),
    Queue('agenta_backend.tasks.evaluations.auto_regex_test',
          Exchange('agenta_backend.tasks.evaluations.auto_regex_test'),
          routing_key='agenta_backend.tasks.evaluations.auto_regex_test'),
)
