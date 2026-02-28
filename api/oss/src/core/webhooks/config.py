"""Centralized webhook configuration."""

# Retry Configuration
WEBHOOK_MAX_RETRIES = 5

# Request Configuration
WEBHOOK_TIMEOUT = 10.0  # seconds per request

# Test Configuration
WEBHOOK_TEST_POLL_INTERVAL_MS = 500
WEBHOOK_TEST_MAX_ATTEMPTS = 20
