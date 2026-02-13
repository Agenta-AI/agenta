"""Webhook utility functions."""

import random
from datetime import datetime, timedelta, timezone

from oss.src.core.webhooks.config import (
    WEBHOOK_RETRY_BASE_DELAY,
    WEBHOOK_RETRY_MULTIPLIER,
    WEBHOOK_RETRY_MAX_DELAY,
    WEBHOOK_RETRY_JITTER_FACTOR,
)


def calculate_next_retry_at(attempt: int) -> datetime:
    """
    Calculate next retry time with exponential backoff and jitter.

    Formula: delay = min(base * (multiplier^attempt), max_delay) ± jitter
    Schedule: ~1s, ~5s, ~25s, ~125s, ~625s (with ±20% jitter)

    Args:
        attempt: Current attempt number (0-indexed)

    Returns:
        Datetime for next retry

    Examples:
        >>> # attempt=0: ~1s, attempt=1: ~5s, attempt=2: ~25s
        >>> next_retry = calculate_next_retry_at(0)
        >>> # Returns time ~1 second from now (with jitter)
    """
    # Calculate base delay with exponential backoff
    base_delay = WEBHOOK_RETRY_BASE_DELAY * (WEBHOOK_RETRY_MULTIPLIER**attempt)

    # Cap at maximum delay
    capped_delay = min(base_delay, WEBHOOK_RETRY_MAX_DELAY)

    # Add jitter: ±20% randomness to prevent thundering herd
    jitter = capped_delay * WEBHOOK_RETRY_JITTER_FACTOR * (random.random() * 2 - 1)
    final_delay = max(0, capped_delay + jitter)

    return datetime.now(timezone.utc) + timedelta(seconds=final_delay)
