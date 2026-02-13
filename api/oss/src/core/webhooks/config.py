"""Centralized webhook configuration."""

# Retry Configuration
WEBHOOK_MAX_RETRIES = 5
WEBHOOK_RETRY_BASE_DELAY = 1.0  # seconds
WEBHOOK_RETRY_MULTIPLIER = 5.0
WEBHOOK_RETRY_MAX_DELAY = 600.0  # 10 minutes
WEBHOOK_RETRY_JITTER_FACTOR = 0.2  # ±20%

# Request Configuration
WEBHOOK_TIMEOUT = 10.0  # seconds per request
